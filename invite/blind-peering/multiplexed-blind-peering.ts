import BlindPairing, { type Candidate, type Member } from "blind-pairing";
import type Hyperswarm from "hyperswarm";
import type { InviteUpdateHandler } from "./invite-update-handler.js";
import type { IInviteDatabase } from "./database/invite-database.js";
import ReadyResource from "ready-resource";
import type { InternalInboundInvite } from "./model.js";
import b4a from 'b4a';
import { decode, encode, type Codec } from "compact-encoding";
import {Mutex} from 'async-mutex';
import { SequentialRunner } from "./sequential-runner.js";

export type InboundInviteHandlerOpts<InboundPayload, OutboundPayload> = {
    invite: InternalInboundInvite<InboundPayload>,
    database: IInviteDatabase<InboundPayload, OutboundPayload>,
    updateHandler: InviteUpdateHandler<InboundPayload, OutboundPayload>
}

export type OutboundInviteHandlerOpts<InboundPayload, OutboundPayload> = {
    discoveryKey: Uint8Array,
    purpose: string,
    expiresMillisSinceEpoch: number | null,
    removeInviteOnFullyUsed: boolean,
    database: IInviteDatabase<InboundPayload, OutboundPayload>,
    updateHandler: InviteUpdateHandler<InboundPayload, OutboundPayload>,
    inboundCodec: Codec<InboundPayload>,
    outboundCodec: Codec<OutboundPayload>
}

type HandlerEntry = {
    handlerOpts: OutboundInviteHandlerOpts<unknown, unknown>,
    member: Member
}

export class MultiplexedBlindPeering extends ReadyResource {

    private sequentialRunner: SequentialRunner;

    private blindPairing: BlindPairing;
    private outboundHandlers: Record<string, Array<HandlerEntry>> = {}

    constructor(hyperswarm: Hyperswarm) {
        super();

        this.sequentialRunner = new SequentialRunner();
        this.blindPairing = new BlindPairing(hyperswarm);
    }

    protected override async _open(): Promise<void> {
        await this.blindPairing.ready();
    }

    protected override async _close(): Promise<void> {
        // TODO (robust): do we need to close each member/candidate ourselves?
        await this.blindPairing.close();
    }

    async addOutboundInviteHandler<InboundPayload, OutboundPayload>(
        outboundInviteHandlerOpts: OutboundInviteHandlerOpts<InboundPayload, OutboundPayload>): Promise<void> {
            const discoveryKeyHex = b4a.toString(outboundInviteHandlerOpts.discoveryKey);
            const handler = this.outboundHandlers[discoveryKeyHex]
                ?.find(handler => handler.handlerOpts.purpose === outboundInviteHandlerOpts.purpose);

            if (handler !== undefined) {
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

                this.outboundHandlers[discoveryKeyHex] = [{member: m, handlerOpts: outboundInviteHandlerOpts}]

                await (m as any).flushed();
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
        const outboundPayload = encode(outboundInviteHandlerOpts.outboundCodec, dbEntry.extraData);

        if (dbEntry.expiresMillisSinceEpoch && dbEntry.expiresMillisSinceEpoch > Date.now()) {
            candidate.confirm(outboundPayload)
        }
        else if (existingRedemption) {
            candidate.confirm(outboundPayload)
        }
        else if (dbEntry.remaining === 0) {
            candidate.deny({status: 2});
            return;
        } else {
            candidate.confirm(outboundPayload)
            const remaining = dbEntry.remaining ? dbEntry.remaining - 1 : null;
            dbEntry.remaining = remaining;

            // TODO (robust): do these two in a batch / transaction at the database class level
            await outboundInviteHandlerOpts.database.upsertOutbound(dbEntry);
            await outboundInviteHandlerOpts.database.addInviteAcceptance(inviteId, sessionId)

            await outboundInviteHandlerOpts.updateHandler.onInviteAccepted(dbEntry, decodedInbound)
        }
    }

    removeOutboundInviteHandler(discoveryKey: Uint8Array, purpose: string): void {

    }

    addInboundInviteHandler<InboundPayload, OutboundPayload>(
        OutboundInviteHandlerOpts: InboundInviteHandlerOpts<InboundPayload, OutboundPayload>): ReadyResource {
        throw new Error('wip')
    }

}