import BlindPairing, { type Candidate, type Member } from "blind-pairing";
import type Hyperswarm from "hyperswarm";
import type { InviteUpdateEvent } from "./invite-update-event.js";
import type { IInviteDatabase } from "./database/invite-database.js";
import ReadyResource from "ready-resource";
import type { InternalInboundInvite } from "./database/model/invite-model.js";
import b4a from 'b4a';
import { decode, encode, type Codec } from "compact-encoding";
import { SequentialRunner } from "./sequential-runner.js";
import { EventEmitter } from "tseep";

export type InboundInviteHandlerOpts<InboundPayload, OutboundPayload> = {
    invite: InternalInboundInvite<InboundPayload>,
    database: IInviteDatabase<InboundPayload, OutboundPayload>,
    eventEmitter: EventEmitter<InviteUpdateEvent<InboundPayload, OutboundPayload>>,
    inboundCodec: Codec<InboundPayload>,
    outboundCodec: Codec<OutboundPayload>
}

export type OutboundInviteHandlerOpts<InboundPayload, OutboundPayload> = {
    discoveryKey: Uint8Array,
    purpose: string,
    expiresMillisSinceEpoch: number | null,
    database: IInviteDatabase<InboundPayload, OutboundPayload>,
    eventEmitter: EventEmitter<InviteUpdateEvent<InboundPayload, OutboundPayload>>,
    inboundCodec: Codec<InboundPayload>,
    outboundCodec: Codec<OutboundPayload>
}

type HandlerEntry = {
    handlers: Array<OutboundInviteHandlerOpts<unknown, unknown>>,
    member: Member
}

export class MultiplexedBlindPeering extends ReadyResource {

    private sequentialRunner: SequentialRunner;
    private blindPairing: BlindPairing;
    
    private outboundHandlers: Record<string, HandlerEntry> = {}
    private timerTask: NodeJS.Timeout | null = null;

    constructor(hyperswarm: Hyperswarm) {
        super();

        this.sequentialRunner = new SequentialRunner();
        this.blindPairing = new BlindPairing(hyperswarm, {poll: 20});
    }

    protected override async _open(): Promise<void> {
        await this.blindPairing.ready();
        this.timerTask = this.startCleanupTimerTask();
    }

    protected override async _close(): Promise<void> {
        if (this.timerTask) {
            clearInterval(this.timerTask);
        }

        // TODO (robust): do we need to close each member/candidate ourselves?
        await this.blindPairing.close();
    }

    private startCleanupTimerTask(): NodeJS.Timeout {
        const interval = setInterval(() => this.removeExpired(this.outboundHandlers), 60000);

        return interval
    }

    private async removeExpired(outboundHandlers: Record<string, HandlerEntry>) {
        const promises: Array<Promise<void>> = []

        // TODO: fix scoping issue of outboundHandlers here
        for (const [key, value] of Object.entries(outboundHandlers)) {
            const activeEntries = value.handlers.filter(
                entry => entry.expiresMillisSinceEpoch === null || entry.expiresMillisSinceEpoch > Date.now()
            );

            this.outboundHandlers[key] = {
                member: value.member, handlers: activeEntries 
            };

            if (activeEntries.length === 0) {
                delete this.outboundHandlers[key];
                const promise = value.member.close();
                promises.push(promise);
            }
        }

        await Promise.all(promises);
    }

    async addOutboundInviteHandler<InboundPayload, OutboundPayload>(
        outboundInviteHandlerOpts: OutboundInviteHandlerOpts<InboundPayload, OutboundPayload>): Promise<void> {
            const discoveryKeyHex = b4a.toString(outboundInviteHandlerOpts.discoveryKey, 'hex');
            const handler = this.outboundHandlers[discoveryKeyHex];

            const _outboundInviteHandlerOpts = outboundInviteHandlerOpts as OutboundInviteHandlerOpts<unknown, unknown>;

            if (handler === undefined) {
                const outer = this;

                const m = this.blindPairing.addMember(
                    {
                        discoveryKey: outboundInviteHandlerOpts.discoveryKey,

                        async onadd (_candidate: Candidate) {
                            // TODO (robust): expand holepunch blind-peering typescript bindings
                            const candidate = _candidate as unknown as any;
                            const inviteId = b4a.toString(candidate.inviteId, 'hex');

                            await outer.sequentialRunner.runSequentiallyPerId(inviteId, async () =>
                                outer.handleOutboundInviteAcceptance(inviteId, _candidate, outboundInviteHandlerOpts)
                            );
                        }
                    }
                )

                this.outboundHandlers[discoveryKeyHex] = {member: m, handlers: [_outboundInviteHandlerOpts]}

                await (m as any).flushed();
            } else if (!handler.handlers.some(x => x.purpose === outboundInviteHandlerOpts.purpose))  {
                handler.handlers.push(_outboundInviteHandlerOpts)
            }
    }

    private async handleOutboundInviteAcceptance<InboundPayload, OutboundPayload>(
        inviteId: string,
        _candidate: Candidate,
        outboundInviteHandlerOpts: OutboundInviteHandlerOpts<InboundPayload, OutboundPayload>
    ): Promise<void> {
        const candidate = _candidate as unknown as any;
        const sessionId = b4a.toString(candidate.requestData.session, 'hex');

        const dbEntry = await outboundInviteHandlerOpts.database.getInvite(inviteId);

        if (dbEntry === null || dbEntry.direction !== 'outbound') {
            return;
        }

        // TODO (robust): try / catch for decode failure? Is the top level handler of onAdd enough?
        const payload = candidate.open(dbEntry.publicKey);
        const decodedInbound = decode(outboundInviteHandlerOpts.inboundCodec, payload);

        const existingRedemption = await outboundInviteHandlerOpts.database.isAlreadyUsed(inviteId, sessionId);
        const additional = dbEntry.additionalData ? {
            data: encode(outboundInviteHandlerOpts.outboundCodec, dbEntry.additionalData.data),
            signature: dbEntry.additionalData.signature
        } : undefined;

        console.log(`signature is 2: ${b4a.toString(additional?.signature!, 'hex')}`)

        if (!existingRedemption && dbEntry.remaining !== null && dbEntry.remaining === 0) {
            candidate.deny({status: 2});
            return;
        }
        else if (!existingRedemption && (!dbEntry.expiresMillisSinceEpoch || dbEntry.expiresMillisSinceEpoch > Date.now())) {
            console.log(`db key is: ${dbEntry.key}`)
            candidate.confirm({
                key: dbEntry.key,
                additional: additional
            })

            const remaining = dbEntry.remaining ? dbEntry.remaining - 1 : null;
            dbEntry.remaining = remaining;

            await outboundInviteHandlerOpts.database.addInviteAcceptance(dbEntry, sessionId)
            await outboundInviteHandlerOpts.eventEmitter.emit('inviteAccepted', dbEntry, decodedInbound);
        }
        else if (existingRedemption) {
            candidate.confirm({
                key: dbEntry.key,
                additional: additional
            })
        }
    }

    async removeOutboundInviteHandler(discoveryKey: Uint8Array, purpose: string): Promise<void> {
        const discoveryKeyHex = b4a.toString(discoveryKey, 'hex');

        const handlerEntry = this.outboundHandlers[discoveryKeyHex];

        if (handlerEntry === undefined) {
            return;
        } else {
            const purposeHandlerIndex = handlerEntry.handlers.findIndex(handler => handler.purpose === purpose);

            if (purposeHandlerIndex > -1) {
                const [removed] = handlerEntry.handlers.splice(purposeHandlerIndex, 1)

                if (handlerEntry.handlers.length === 0 && removed !== undefined) {
                    delete this.outboundHandlers[discoveryKeyHex];
                    await handlerEntry.member.close()
                }
            }
        }
    }

    async addInboundInviteHandler<InboundPayload, OutboundPayload>(
        inboundHandlerOpts: InboundInviteHandlerOpts<InboundPayload, OutboundPayload>): Promise<ReadyResource> {

        const userData = encode(inboundHandlerOpts.inboundCodec, inboundHandlerOpts.invite.payload);

        console.log(`Invite handed to candidate is: ${b4a.toString(inboundHandlerOpts.invite.invite, 'hex')}`)

        // TODO (robust): update holepunch typescript bindings to include 'data' parameter
        const candidate = (this.blindPairing as any).addCandidate({
            invite: inboundHandlerOpts.invite.invite,
            userData: userData,
            onadd: (result: any) => {
                console.log(result);
            }
        })

        // TODO (robust): update holepunch typescript bindings to include 'pairing' promise field
        candidate.pairing
        .then(async (result: any) => {
                const decodedData = decode(inboundHandlerOpts.outboundCodec, result.data)

                inboundHandlerOpts.invite.status = 'complete';
                
                await inboundHandlerOpts.database.upsertInbound(
                    inboundHandlerOpts.invite
                )

                inboundHandlerOpts.eventEmitter.emit('inviteConfirmed', inboundHandlerOpts.invite, result.key, decodedData);
                
                await candidate.close()
        })
        .catch ( async (_: unknown) =>  {
            inboundHandlerOpts.invite.status = 'failed';
            await inboundHandlerOpts.database.upsertInbound(inboundHandlerOpts.invite);
            await inboundHandlerOpts.eventEmitter.emit('inviteRejected', inboundHandlerOpts.invite);
        })
        
        return candidate;
    }

}