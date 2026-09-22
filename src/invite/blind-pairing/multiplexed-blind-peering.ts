import BlindPairing, { type Candidate, type Member } from "blind-pairing";
import type Hyperswarm from "hyperswarm";
import type { InviteUpdateEvent } from "./invite-update-handler.js";
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
    removeInviteOnFullyUsed: boolean,
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
        this.blindPairing = new BlindPairing(hyperswarm);
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
        const interval = setInterval(this.removeExpired, 60000);

        return interval
    }

    private async removeExpired() {
        const promises: Array<Promise<void>> = []

        for (const [key, value] of Object.entries(this.outboundHandlers)) {
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
            const discoveryKeyHex = b4a.toString(outboundInviteHandlerOpts.discoveryKey);
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
                            const inviteId = b4a.toString(candidate.request.inviteId, 'hex');

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
        const sessionId = candidate.request.session;

        const dbEntry = await outboundInviteHandlerOpts.database.getInvite(inviteId);

        if (dbEntry === null || dbEntry.direction !== 'outbound') {
            return;
        }

        // TODO (robust): try / catch for decode failure? Is the top level handler of onAdd enough?
        const payload = candidate.open(dbEntry.publicKey);
        const decodedInbound = decode(outboundInviteHandlerOpts.inboundCodec, payload);

        const existingRedemption = await outboundInviteHandlerOpts.database.isAlreadyUsed(inviteId, candidate.request.session);
        const additional = dbEntry.additionalData ? {
            data: encode(outboundInviteHandlerOpts.outboundCodec, dbEntry.additionalData.data),
            signature: dbEntry.additionalData.signature
        } : undefined;

        if (!existingRedemption && dbEntry.remaining !== null && dbEntry.remaining === 0) {
            candidate.deny({status: 2});
            return;
        }
        else if (!existingRedemption && (!dbEntry.expiresMillisSinceEpoch || dbEntry.expiresMillisSinceEpoch > Date.now())) {
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

        // TODO (robust): update holepunch typescript bindings to include 'data' parameter
        const candidate = (this.blindPairing as any).addCandidate({
            invite: inboundHandlerOpts.invite.invite,
            userData: userData,
            async onadd( result: { key: Uint8Array; encryptionKey: Uint8Array, data: Uint8Array } ) {
                const decodedData = decode(inboundHandlerOpts.outboundCodec, result.data)

                inboundHandlerOpts.invite.status = 'complete';
                
                await inboundHandlerOpts.database.upsertInbound(
                    inboundHandlerOpts.invite
                )

                inboundHandlerOpts.eventEmitter.emit('inviteConfirmed', inboundHandlerOpts.invite, decodedData);
                
                await candidate.close()
            }
        })

        // TODO (robust): update holepunch typescript bindings to include 'pairing' promise field
        candidate.pairing.catch ( async (_: unknown) =>  {
            inboundHandlerOpts.invite.status = 'failed';
            await inboundHandlerOpts.database.upsertInbound(inboundHandlerOpts.invite);
            await inboundHandlerOpts.eventEmitter.emit('inviteRejected', inboundHandlerOpts.invite);
        })
        
        return candidate;
    }

}