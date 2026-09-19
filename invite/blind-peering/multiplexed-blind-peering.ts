import BlindPairing, { type Candidate, type Member } from "blind-pairing";
import type Hyperswarm from "hyperswarm";
import type { InviteUpdateHandler } from "./invite-update-handler.js";
import type { IInviteDatabase } from "./database/invite-database.js";
import ReadyResource from "ready-resource";
import type { InternalInboundInvite } from "./model.js";
import b4a from 'b4a';
import { decode, encode, type Codec } from "compact-encoding";
import {Mutex} from 'async-mutex';

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

    private blindPairing: BlindPairing;
    private outboundHandlers: Record<string, Array<HandlerEntry>> = {}

    private mutexes: Record<string, Mutex> = {}

    constructor(hyperswarm: Hyperswarm) {
        super();

        this.blindPairing = new BlindPairing(hyperswarm);
    }

    protected override async _close(): Promise<void> {
        // TODO (robust): do we need to close each member/candidate ourselves?
        await this.blindPairing.close()
    }

    async addOutboundInviteHandler<InboundPayload, OutboundPayload>(
        details: OutboundInviteHandlerOpts<InboundPayload, OutboundPayload>): Promise<void> {
            const discoveryKeyHex = b4a.toString(details.discoveryKey);

            const existingHandler = this.outboundHandlers[discoveryKeyHex]?.find(handler => handler.handlerOpts.purpose === details.purpose);

            if (existingHandler !== undefined) {
                const outer = this;

                const m = this.blindPairing.addMember(
                    {
                        discoveryKey: details.discoveryKey,
                        async onadd (_candidate: Candidate) {
                            // TODO (robust): mutex per invite ID

                            const candidate = _candidate as unknown as any;
                            const inviteId = b4a.toString(candidate.request.inviteId, 'hex');

                            const dbEntry = await details.database.getInvite(inviteId);

                            if (dbEntry === null || dbEntry.direction !== 'outbound') {
                                return;
                            }

                            // TODO (robust): try / catch for decode failure? Is the top level handler of onAdd enough?
                            const payload = candidate.open(dbEntry.publicKey);
                            const decodedInbound = decode(details.inboundCodec, payload);

                            const existingRedemption = await details.database.isAlreadyUsed(inviteId, candidate.request.session);

                            const outboundPayload = encode(details.outboundCodec, dbEntry.extraData);

                            if (dbEntry.expiresMillisSinceEpoch && dbEntry.expiresMillisSinceEpoch > Date.now()) {
                                candidate.confirm(outboundPayload)
                            }
                            else if (existingRedemption) {
                                candidate.confirm(outboundPayload)
                                existingHandler.handlerOpts.updateHandler.onInviteAccepted(dbEntry, decodedInbound)
                            }
                            else if (dbEntry.remaining === 0) {
                                candidate.deny({status: 2});
                                return;
                            } else {
                                candidate.confirm(outboundPayload)
                                existingHandler.handlerOpts.updateHandler.onInviteAccepted(dbEntry, decodedInbound)

                                // TODO: reduce the db count by one 
                            }

                            

                        }
                    }
                )

                this.outboundHandlers[discoveryKeyHex] = [{member: m, handlerOpts: details}]

                await (m as any).flushed();



            }
    }

    removeOutboundInviteHandler(discoveryKey: Uint8Array, purpose: string): void {

    }

    addInboundInviteHandler<InboundPayload, OutboundPayload>(
        details: InboundInviteHandlerOpts<InboundPayload, OutboundPayload>): ReadyResource {
        throw new Error('wip')
    }

}