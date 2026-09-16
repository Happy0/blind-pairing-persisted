import ReadyResource from "ready-resource";
import type { IInviteDatabase } from "./database/invite-database.js";
import type { InviteUpdateHandler } from "./invite-update-handler.js";
import type Hyperswarm from "hyperswarm";
import type { InviteId, OutboundInvite } from "./model.js";
import BlindPairing, { type Candidate, type Member } from "blind-pairing";

export interface IInviteManager<InboundPayload, OutboundPayload> {
    createInvite(purpose: string, count: number, expiresMillisSinceEpoch: number | null): Promise<OutboundInvite<OutboundPayload>>;

    useInvite(invite: Uint8Array): Promise<void>;

    deleteInvite(inviteId: string): Promise<void>;
}

export class InviteManager<InboundPayload, OutboundPayload> extends ReadyResource implements IInviteManager<InboundPayload, OutboundPayload>  {

    private inviteUpdateHandler: InviteUpdateHandler<InboundPayload, OutboundPayload>;
    private inviteDatabase: IInviteDatabase<InboundPayload, OutboundPayload>;
    private blindPairing: BlindPairing;

    private members: Record<InviteId, Member> = {};

    constructor(
        hyperswarm: Hyperswarm,
        inviteDatabase: IInviteDatabase<InboundPayload, OutboundPayload>,
        inviteUpdateHandler: InviteUpdateHandler<InboundPayload, OutboundPayload>
    ) {
        super();

        this.inviteUpdateHandler = inviteUpdateHandler;
        this.inviteDatabase = inviteDatabase;
        this.blindPairing = new BlindPairing(hyperswarm);
    }

    async deleteInvite(inviteId: string): Promise<void> {
        await this.inviteDatabase.deleteOutboundInvite(inviteId);
        const member = this.members[inviteId];

        if (member) {
            await member.close();
        }

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

    private addMember(outboundInvite: OutboundInvite<OutboundPayload>): void {

        const member = this.blindPairing.addMember({
            discoveryKey: outboundInvite.discoveryKey,
            // TODO (robust): make pull request to holepunch types to expand Candidate type with fields available
            async onadd(candidate: any) {
                const payload = candidate.open(outboundInvite.publicKey)
                
            }
        })

        this.members[outboundInvite.inviteId] = member;
    }

    override async _close(): Promise<void> {
        // Close the member / candidates attached to blindPairing

    }

}