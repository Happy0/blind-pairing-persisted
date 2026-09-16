import ReadyResource from "ready-resource";
import type { IInviteDatabase } from "./database/invite-database.js";
import type { InviteUpdateHandler } from "./invite-update-handler.js";
import type Hyperswarm from "hyperswarm";
import type { OutboundInvite } from "./model.js";
import BlindPairing, { type Candidate, type Member } from "blind-pairing";

export interface IInviteManager<OutboundPayload, InboundPayload> {
    createInvite(purpose: string, count: number, expiresMillisSinceEpoch: number | null): Promise<OutboundInvite<OutboundPayload>>;

    useInvite(invite: Uint8Array): Promise<void>;

    deleteInvite(inviteId: string): Promise<void>;
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
    
    deleteInvite(inviteId: string): Promise<void> {
        throw new Error("Method not implemented.");
    }

    createInvite(purpose: string, count: number, expiresMillisSinceEpoch: number | null): Promise<OutboundInvite<OutboundPayload>> {
        // const invite = BlindPairing.createInvite()

        throw new Error("Method not implemented.");
    }
    
    useInvite(invite: Uint8Array): Promise<void> {
        throw new Error("Method not implemented.");
    }

    override async _open(): Promise<void> {
        // Grab all the persisted invites / invite acceptances from the database and add them to blindPairing as members / candidates

        for await (const outboundInvite of this.inviteDatabase.getAllActiveOutbound()) {
            const member = this.addMember(outboundInvite);
        }
    }

    private addMember(outboundInvite: OutboundInvite<OutboundPayload>): Member {

        const member = this.blindPairing.addMember({
            discoveryKey: outboundInvite.discoveryKey,
            // TODO (robust): make pull request to holepunch types to expand Candidate type with fields available
            async onadd(candidate: any) {
                const payload = candidate.open(outboundInvite.publicKey)
                
            }
        })

        return member;
    }

    override async _close(): Promise<void> {
        // Close the member / candidates attached to blindPairing

    }

}