import ReadyResource from "ready-resource";
import type { IInviteDatabase } from "./database/invite-database.js";
import type { InviteUpdateHandler } from "./invite-update-handler.js";
import type Hyperswarm from "hyperswarm";
import { type InviteId, type InternalOutboundInvite } from "./model.js";
import BlindPairing, {type Candidate, type Member } from "blind-pairing";
import {string} from 'compact-encoding/index.js'
import { encode, type Codec } from "compact-encoding";
import b4a from 'b4a';
import type { MultiplexedBlindPeering } from "./multiplexed-blind-peering.js";

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
    private multiplexedBlindPeering: MultiplexedBlindPeering;

    private outgoingInvites: Record<string, ReadyResource> = {};
    private inboundInvites: Record<string, ReadyResource> = {};

    constructor(
        multiplexedBlindPeering: MultiplexedBlindPeering,
        inviteDatabase: IInviteDatabase<InboundPayload, OutboundPayload>,
        inviteUpdateHandler: InviteUpdateHandler<InboundPayload, OutboundPayload>,
    ) {

        super();
        this.inviteUpdateHandler = inviteUpdateHandler;
        this.inviteDatabase = inviteDatabase;

        this.multiplexedBlindPeering = multiplexedBlindPeering;
    }

    protected override _open(): Promise<void> {
        const outboundDiscoveryKeys = this.inviteDatabase.getAllActiveOutbound()
        const inboundDiscoveryKeys = this.inviteDatabase.getAllActiveInbound();

        throw new Error('wip')
    }

    protected override async _close(): Promise<void> {
        const outgoing = Object.values(this.outgoingInvites).map(invite => invite.close());
        const incoming = Object.values(this.inboundInvites).map(invite => invite.close());

        await Promise.all([...outgoing, ...incoming]);
    }

    async deleteInvite(inviteId: string): Promise<void> {
        await this.inviteDatabase.deleteInvite(inviteId);

        const inbound = this.inboundInvites[inviteId];

        if (inbound) {
            inbound.close();
        }

        const outbound = this.outgoingInvites[inviteId];

        if (outbound) {
            outbound.close()
        }
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
        this.listenForInviteAcceptance(outboundInvite);

        return outboundInvite;
    }

    useInvite(invite: Invite): Promise<void> {
        throw new Error("Method not implemented.");
    }

    private listenForInviteAcceptance(invite: InternalOutboundInvite<OutboundPayload>): void {
        const resource = this.multiplexedBlindPeering.addOutboundInviteHandler(invite.discoveryKey, invite.purpose, this.inviteDatabase, this.inviteUpdateHandler)
        this.outgoingInvites[invite.inviteId] = resource;
    }
    


}