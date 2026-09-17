import BlindPairing, { type Candidate } from "blind-pairing";
import type Hyperswarm from "hyperswarm";
import type { InviteUpdateHandler } from "./invite-update-handler.js";
import type { IInviteDatabase } from "./database/invite-database.js";
import ReadyResource from "ready-resource";

// TODO (readability: come up with a better name for this thing ':D)
export class MultiplexedBlindPeering extends ReadyResource {

    private blindPairing: BlindPairing;

    constructor(hyperswarm: Hyperswarm) {
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
        database: IInviteDatabase<InboundPayload, OutboundPayload>,
        updateHandler: InviteUpdateHandler<InboundPayload, OutboundPayload>): void {
            throw new Error('wip')
    }

    removeOutboundInviteHandler(discoveryKey: Uint8Array, purpose: string): void {

    }

    addInboundInviteHandler<InboundPayload, OutboundPayload>(
        invite: Uint8Array,
        database: IInviteDatabase<InboundPayload, OutboundPayload>,
        updateHandler: InviteUpdateHandler<InboundPayload, OutboundPayload>): ReadyResource {
        throw new Error('wip')
    }

}