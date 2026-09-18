import BlindPairing, { type Candidate } from "blind-pairing";
import type Hyperswarm from "hyperswarm";
import type { InviteUpdateHandler } from "./invite-update-handler.js";
import type { IInviteDatabase } from "./database/invite-database.js";
import ReadyResource from "ready-resource";
import type { InternalInboundInvite } from "./model.js";

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
    updateHandler: InviteUpdateHandler<InboundPayload, OutboundPayload>
}

// TODO (readability: come up with a better name for this thing ':D)
export class MultiplexedBlindPeering extends ReadyResource {

    private blindPairing: BlindPairing;

    private outboundHandlers: Record<string, InboundInviteHandlerOpts<unknown, unknown>> = {}

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
            throw new Error('wip')
    }

    removeOutboundInviteHandler(discoveryKey: Uint8Array, purpose: string): void {

    }

    addInboundInviteHandler<InboundPayload, OutboundPayload>(
        details: InboundInviteHandlerOpts<InboundPayload, OutboundPayload>): ReadyResource {
        throw new Error('wip')
    }

}