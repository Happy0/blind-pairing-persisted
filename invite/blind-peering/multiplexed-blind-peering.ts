import BlindPairing, { type Candidate } from "blind-pairing";
import type Hyperswarm from "hyperswarm";
import type { InviteUpdateHandler } from "./invite-update-handler.js";
import type { IInviteDatabase } from "./database/invite-database.js";
import ReadyResource from "ready-resource";
import type { InternalInboundInvite } from "./model.js";

type Opts = {
    removeInviteOnFullyUsed: boolean
};

// TODO (readability: come up with a better name for this thing ':D)
export class MultiplexedBlindPeering extends ReadyResource {

    private blindPairing: BlindPairing;

    constructor(hyperswarm: Hyperswarm, opts: Opts | undefined) {
        super();

        this.blindPairing = new BlindPairing(hyperswarm);
    }

    protected override async _close(): Promise<void> {
        // TODO (robust): do we need to close each member/candidate ourselves?
        await this.blindPairing.close()
    }

    addOutboundInviteHandler<InboundPayload, OutboundPayload>(
        discoveryKey: Uint8Array,
        purpose: string,
        expiresMillisSinceEpoch: number | null,
        database: IInviteDatabase<InboundPayload, OutboundPayload>,
        updateHandler: InviteUpdateHandler<InboundPayload, OutboundPayload>): void {
            throw new Error('wip')
    }

    removeOutboundInviteHandler(discoveryKey: Uint8Array, purpose: string): void {

    }

    addInboundInviteHandler<InboundPayload, OutboundPayload>(
        invite: InternalInboundInvite<InboundPayload>,
        database: IInviteDatabase<InboundPayload, OutboundPayload>,
        updateHandler: InviteUpdateHandler<InboundPayload, OutboundPayload>): ReadyResource {
        throw new Error('wip')
    }

}