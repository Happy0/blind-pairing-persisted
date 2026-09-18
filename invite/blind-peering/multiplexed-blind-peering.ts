import BlindPairing, { type Candidate, type Member } from "blind-pairing";
import type Hyperswarm from "hyperswarm";
import type { InviteUpdateHandler } from "./invite-update-handler.js";
import type { IInviteDatabase } from "./database/invite-database.js";
import ReadyResource from "ready-resource";
import type { InternalInboundInvite } from "./model.js";
import b4a from 'b4a';
import { decode, type Codec } from "compact-encoding";

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

    constructor(hyperswarm: Hyperswarm) {
        super();

        this.blindPairing = new BlindPairing(hyperswarm);
    }

    protected override async _close(): Promise<void> {
        // TODO (robust): do we need to close each member/candidate ourselves?
        await this.blindPairing.close()
    }

    addOutboundInviteHandler<InboundPayload, OutboundPayload>(
        details: OutboundInviteHandlerOpts<InboundPayload, OutboundPayload>): void {
            const discoveryKeyHex = b4a.toString(details.discoveryKey);

            const existingHandler = this.outboundHandlers[discoveryKeyHex]?.find(handler => handler.handlerOpts.purpose === details.purpose);

            if (existingHandler !== undefined) {
                const m = this.blindPairing.addMember(
                    {
                        discoveryKey: details.discoveryKey,
                        async onadd (_candidate: Candidate) {
                            const candidate = _candidate as unknown as any;
                            const inviteId = candidate.inviteId;

                            const dbEntry = await details.database.getInvite(inviteId);

                            if (dbEntry === null || dbEntry.direction !== 'outbound') {
                                return;
                            }

                            const payload = candidate.open(dbEntry.publicKey);
                            const decodedInbound = decode(details.inboundCodec, payload);

                            

                        }
                    }
                )

                this.outboundHandlers[discoveryKeyHex] = [{member: m, handlerOpts: details}]
            }
    }

    removeOutboundInviteHandler(discoveryKey: Uint8Array, purpose: string): void {

    }

    addInboundInviteHandler<InboundPayload, OutboundPayload>(
        details: InboundInviteHandlerOpts<InboundPayload, OutboundPayload>): ReadyResource {
        throw new Error('wip')
    }

}