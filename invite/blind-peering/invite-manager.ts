import ReadyResource from "ready-resource";
import type { IInviteDatabase } from "./database/invite-database.js";
import type { InviteUpdateHandler } from "./invite-update-handler.js";
import type Hyperswarm from "hyperswarm";
import { type InviteId, type InternalOutboundInvite } from "./model.js";
import BlindPairing, {type Candidate, type Member } from "blind-pairing";
import {string} from 'compact-encoding/index.js'
import { encode, type Codec } from "compact-encoding";
import b4a from 'b4a';

export type OutboundInvite = {
     invite: Uint8Array
}

export type InboundInvite = {
    invite: Uint8Array
}

export interface IInviteManager<InboundPayload, OutboundPayload> {
    createInvite(
        discoveryKey: Uint8Array,
        purpose: string,
        count: number,
        expiresMillisSinceEpoch: number | null,
        payload: OutboundPayload): Promise<OutboundInvite>;

    useInvite(InboundInvite: InboundInvite): Promise<void>;

    deleteInvite(inviteId: string): Promise<void>;
}

export class InviteManager<InboundPayload, OutboundPayload> extends ReadyResource implements IInviteManager<InboundPayload, OutboundPayload>  {

    private inviteUpdateHandler: InviteUpdateHandler<InboundPayload, OutboundPayload>;
    private inviteDatabase: IInviteDatabase<InboundPayload, OutboundPayload>;
    private blindPairing: BlindPairing;

    private members: Record<InviteId, Member> = {};
    private candidates: Record<InviteId, Candidate> = {};

    private inboundDataCodec: Codec<InboundPayload>;
    private outboundDataCodec: Codec<OutboundPayload>;

    constructor(
        hyperswarm: Hyperswarm,
        inviteDatabase: IInviteDatabase<InboundPayload, OutboundPayload>,
        inviteUpdateHandler: InviteUpdateHandler<InboundPayload, OutboundPayload>,
        outboundDataCodec: Codec<OutboundPayload>,
        inboundDataCodec: Codec<InboundPayload>
    ) {
        super();

        this.inviteUpdateHandler = inviteUpdateHandler;
        this.inviteDatabase = inviteDatabase;
        this.blindPairing = new BlindPairing(hyperswarm);

        this.inboundDataCodec = inboundDataCodec;
        this.outboundDataCodec = outboundDataCodec;

    }

    async deleteInvite(inviteId: string): Promise<void> {
        await this.inviteDatabase.deleteOutboundInvite(inviteId);
        const member = this.members[inviteId];

        if (member) {
            await member.close();
        }
    }

    async createInvite(
        discoveryKey: Uint8Array,
        purpose: string,
        count: number,
        expiresMillisSinceEpoch: number | null, 
        payload: OutboundPayload): Promise<InternalOutboundInvite<OutboundPayload>> {
                
        const invite = BlindPairing.createInvite(discoveryKey, {
            data: encode(string, purpose)
        })

        const inviteId = b4a.toString(invite.id, 'hex');

        const outboundInvite: InternalOutboundInvite<OutboundPayload> = {
            count: count,
            createdAtMillisSinceEpoch: Date.now(),
            direction: 'outbound',
            discoveryKey: discoveryKey,
            expiresMillisSinceEpoch: expiresMillisSinceEpoch,
            extraData: payload,
            invite: invite.invite,
            inviteId: inviteId,
            publicKey: invite.publicKey,
            purpose: purpose,
            remaining: count
        }

        await this.inviteDatabase.upsertOutbound(outboundInvite);
        this.listenForInviteRedemptions(outboundInvite);

        return outboundInvite;
    }
    
    useInvite(invite: InboundInvite): Promise<void> {
        throw new Error("Method not implemented.");
    }

    override async _open(): Promise<void> {
        // Grab all the persisted invites / invite acceptances from the database and add them to blindPairing as members / candidates

        for await (const outboundInvite of this.inviteDatabase.getAllActiveOutbound()) {
            this.listenForInviteRedemptions(outboundInvite);
        }

        // TODO: also add the 'candidates'
    }

    private listenForInviteRedemptions(outboundInvite: InternalOutboundInvite<OutboundPayload>): void {

        const member = this.blindPairing.addMember({
            discoveryKey: outboundInvite.discoveryKey,
            async onadd(_candidate: Candidate) {
                // TODO (robust): make pull request to holepunch types to expand Candidate type with fields available
                const candidate = _candidate as unknown as any;

                const payload = candidate.open(outboundInvite.publicKey)
                
            }
        })

        this.members[outboundInvite.inviteId] = member;
    }

    override async _close(): Promise<void> {

        const resources = [
                ...Object.values(this.members),
                ...Object.values(this.candidates)
        ]

        await Promise.all(
            resources.map(resource => resource.close())
        )
    }

}