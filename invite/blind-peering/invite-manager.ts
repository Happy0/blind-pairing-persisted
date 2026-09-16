import ReadyResource from "ready-resource";
import type { IInviteDatabase } from "./database/invite-database.js";
import type { InviteUpdateHandler } from "./invite-update-handler.js";
import type Hyperswarm from "hyperswarm";
import { type InviteId, type InternalOutboundInvite } from "./model.js";
import BlindPairing, {type Candidate, type Member } from "blind-pairing";
import {string} from 'compact-encoding/index.js'
import { encode, type Codec } from "compact-encoding";
import b4a from 'b4a';

export type Invite = {
     invite: Uint8Array,
     purpose: string
}

export interface IInviteManager<InboundPayload, OutboundPayload> {
    createInvite(
        key: Uint8Array,
        purpose: string,
        count: number,
        expiresMillisSinceEpoch: number | null,
        payload: OutboundPayload): Promise<Invite>;

    useInvite(InboundInvite: Invite): Promise<void>;

    deleteInvite(inviteId: string): Promise<void>;
}

export class InviteManager<InboundPayload, OutboundPayload> extends ReadyResource implements IInviteManager<InboundPayload, OutboundPayload>  {

    private inviteUpdateHandler: InviteUpdateHandler<InboundPayload, OutboundPayload>;
    private inviteDatabase: IInviteDatabase<InboundPayload, OutboundPayload>;
    private blindPairing: BlindPairing;

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
        await this.inviteDatabase.deleteInvite(inviteId);
    }

    async createInvite(
        key: Uint8Array,
        purpose: string,
        count: number,
        expiresMillisSinceEpoch: number | null, 
        payload: OutboundPayload): Promise<InternalOutboundInvite<OutboundPayload>> {
                
        const invite = BlindPairing.createInvite(key, {
            data: encode(string, purpose)
        })

        const inviteId = b4a.toString(invite.id, 'hex');

        const outboundInvite: InternalOutboundInvite<OutboundPayload> = {
            count: count,
            createdAtMillisSinceEpoch: Date.now(),
            direction: 'outbound',
            discoveryKey: invite.discoveryKey,
            expiresMillisSinceEpoch: expiresMillisSinceEpoch,
            extraData: payload,
            invite: invite.invite,
            inviteId: inviteId,
            publicKey: invite.publicKey,
            purpose: purpose,
            remaining: count
        }

        await this.inviteDatabase.upsertOutbound(outboundInvite);

        return outboundInvite;
    }
    
    useInvite(invite: Invite): Promise<void> {
        throw new Error("Method not implemented.");
    }

    override async _open(): Promise<void> {
        // Grab all the persisted invites / invite acceptances from the database and add them to blindPairing as members / candidates



        // TODO: also add the 'candidates'
    }

    override async _close(): Promise<void> {
 
    }
}