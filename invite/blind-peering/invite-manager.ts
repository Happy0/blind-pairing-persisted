import ReadyResource from "ready-resource";
import type { IInviteDatabase } from "./database/invite-database.js";
import type { InviteUpdateHandler } from "./invite-update-handler.js";
import type Hyperswarm from "hyperswarm";
import { type InviteId, type InternalOutboundInvite, type InternalInboundInvite } from "./model.js";
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

    useInvite(InboundInvite: Invite, payload: InboundPayload): Promise<void>;

    deleteInvite(inviteId: string): Promise<void>;
}

export class InviteManager<InboundPayload, OutboundPayload> extends ReadyResource implements IInviteManager<InboundPayload, OutboundPayload>  {

    private inviteUpdateHandler: InviteUpdateHandler<InboundPayload, OutboundPayload>;
    private inviteDatabase: IInviteDatabase<InboundPayload, OutboundPayload>;
    private multiplexedBlindPeering: MultiplexedBlindPeering;

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

    protected override async   _open(): Promise<void> {
        const inboundDiscoveryKeys = this.inviteDatabase.getAllActiveInbound();
        const outboundDiscoveryKeys = await this.inviteDatabase.getActiveDiscoveryKeys();

        for (const key of outboundDiscoveryKeys.keys) {
            this.multiplexedBlindPeering.addOutboundInviteHandler(
                key.discoveryKey,
                outboundDiscoveryKeys.purpose,
                this.inviteDatabase,
                this.inviteUpdateHandler
            )
        }

        for await (const inbound of inboundDiscoveryKeys) {
            this.acceptInvite(inbound);
        }

    }

    protected override async _close(): Promise<void> {
        const incoming = Object.values(this.inboundInvites).map(invite => invite.close());
        await Promise.all(incoming);

        const outboundDiscoveryKeys = await this.inviteDatabase.getActiveDiscoveryKeys();

        for (const key of outboundDiscoveryKeys.keys) {
            this.multiplexedBlindPeering.removeOutboundInviteHandler(key.discoveryKey, outboundDiscoveryKeys.purpose);
        }

    }

    async deleteInvite(inviteId: string): Promise<void> {
        const invite = await this.inviteDatabase.getInvite(inviteId);

        if (!invite) {
            return;
        }

        if (invite.direction === 'inbound') {
            const inbound = this.inboundInvites[inviteId];

            await this.inviteDatabase.deleteInvite(inviteId);

            if (inbound) {
                await inbound.close();
            }

        } else {
            await this.inviteDatabase.deleteInvite(inviteId);

            const discoveryKeyInUse = await this.inviteDatabase.hasActiveInviteWithDiscoveryKey(invite.discoveryKey)

            if (!discoveryKeyInUse) {
                await this.multiplexedBlindPeering.removeOutboundInviteHandler(invite.discoveryKey, invite.purpose);
            }
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

    async useInvite(invite: Invite, payload: InboundPayload): Promise<void> {

        // TODO (robust): add decode invite function to holepunch types
        const decodedInvite = (BlindPairing as any).decodeInvite(invite.invite);

        const inboundInvite: InternalInboundInvite<InboundPayload> = {
            createdAtMillisSinceEpoch: Date.now(),
            direction: 'inbound',
            invite: invite.invite,
            expiresMillisSinceEpoch: decodedInvite.expires,
            purpose: invite.purpose,
            status: 'pending',
            inviteId: decodedInvite.id,
            payload: payload,
        }

        await this.inviteDatabase.upsertInbound(inboundInvite);
        await this.acceptInvite(inboundInvite);
    }

    private acceptInvite(inbound: InternalInboundInvite<InboundPayload>): void {
        const resource = this.multiplexedBlindPeering.addInboundInviteHandler(inbound.invite, this.inviteDatabase, this.inviteUpdateHandler)
        this.inboundInvites[inbound.inviteId] = resource;
    }

    private listenForInviteAcceptance(invite: InternalOutboundInvite<OutboundPayload>): void {
        this.multiplexedBlindPeering.addOutboundInviteHandler(
            invite.discoveryKey,
            invite.purpose,
            this.inviteDatabase,
            this.inviteUpdateHandler
        )

    }
    


}