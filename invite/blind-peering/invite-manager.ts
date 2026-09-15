import ReadyResource from "ready-resource";
import type { IInviteDatabase } from "./database/invite-database.js";
import type { InviteUpdateHandler } from "./invite-update-handler.js";
import type Hyperswarm from "hyperswarm";
import type { OutboundInvite } from "./model.js";
import BlindPairing from "blind-pairing";

export interface IInviteManager<OutboundPayload, InboundPayload> {
    createInvite(count: number, expiresMillisSinceEpoch: number | null): Promise<OutboundInvite<OutboundPayload>>;

    useInvite(invite: Uint8Array): Promise<void>;
}


export class InviteManager<OutboundPayload, InboundPayload> extends ReadyResource implements IInviteManager<OutboundPayload, InboundPayload>  {

    private inviteUpdateHandler: InviteUpdateHandler<OutboundPayload, InboundPayload>;
    private inviteDatabase: IInviteDatabase<OutboundPayload, InboundPayload>;
    private blindPairing: BlindPairing;

    constructor(
        hyperswarm: Hyperswarm,
        inviteDatabase: IInviteDatabase<OutboundPayload, InboundPayload>,
        inviteUpdateHandler: InviteUpdateHandler<OutboundPayload, InboundPayload>
    ) {
        super();

        this.inviteUpdateHandler = inviteUpdateHandler;
        this.inviteDatabase = inviteDatabase;
        this.blindPairing = new BlindPairing(hyperswarm);
    }

    createInvite(count: number, expiresMillisSinceEpoch: number | null): Promise<OutboundInvite<OutboundPayload>> {
        throw new Error("Method not implemented.");
    }
    
    useInvite(invite: Uint8Array): Promise<void> {
        throw new Error("Method not implemented.");
    }

    override async _open(): Promise<void> {
        // Grab all the persisted invites / invite acceptances from the database and add them to blindPairing as members / candidates

    }
    override async _close(): Promise<void> {
        // Close the member / candidates attached to blindPairing

    }

}