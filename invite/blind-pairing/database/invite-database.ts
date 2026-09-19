import type { Codec } from "compact-encoding"
import {encode, decode, string} from 'compact-encoding/index.js'
import { type InternalOutboundInvite, type InternalInboundInvite, createOutboundInviteCodec, createInboundInviteCodec } from "../model.js"
import Hyperbee from "hyperbee"
import b4a from 'b4a'

export type InviteAcceptanceResult = {
    outcome: 'added' | 'duplicate'
}

export type DiscoveryKeyUsages = {
    purpose: string,
    keys: Array<{
        discoveryKey: Uint8Array,
        count: number
    }>,
    lastExpiryMillisSinceEpoch: number
}

export interface IInviteDatabase<InboundPayload, OutboundPayload> {
    upsertOutbound(invite: InternalOutboundInvite<OutboundPayload>): Promise<void>
    upsertInbound(invite: InternalInboundInvite<InboundPayload>): Promise<void>

    getInvite(inviteId: string): Promise<InternalOutboundInvite<OutboundPayload> | InternalInboundInvite<InboundPayload> | null>

    deleteInvite(inviteId: string): Promise<void>

    addInviteAcceptance(outboundInviteId: string, sessionId: string): Promise<InviteAcceptanceResult>
    isAlreadyUsed(outboundInviteId: string, sessionId: string): Promise<boolean>;

    getAllActiveInbound(): AsyncIterable<InternalInboundInvite<InboundPayload>>
    getAllInbound(): AsyncIterable<InternalInboundInvite<InboundPayload>>

    getAllActiveOutbound(): AsyncIterable<InternalOutboundInvite<OutboundPayload>>;
    getAllOutbound(): AsyncIterable<InternalOutboundInvite<OutboundPayload>>;

    getActiveDiscoveryKeys(): Promise<DiscoveryKeyUsages>;

    hasActiveInviteWithDiscoveryKey(key: Uint8Array): Promise<boolean>;
};

export class BTreeInviteDatabase<OutboundPayload, InboundPayload> implements IInviteDatabase<InboundPayload, OutboundPayload> {
    private inboundInviteCodec: Codec<InternalInboundInvite<InboundPayload>>;
    private outboundInviteCodec: Codec<InternalOutboundInvite<OutboundPayload>>;
    private privateHyperbee: Hyperbee;

    /**
     * @param privateHyperbee A hyperbee database (not replicated) to store the invite.
     * @param purpose - the type of resource these invites are for - this is used to start a 'sub' database of the hyperbee
     * @param codec A codec for encoding / decoding the payloads sent on invite acceptances in each direction
     */
    constructor(privateHyperbee: Hyperbee, purpose: string, inboundCodec: Codec<InboundPayload>, outboundCodec: Codec<OutboundPayload>) {
        this.inboundInviteCodec = createInboundInviteCodec(inboundCodec);
        this.outboundInviteCodec = createOutboundInviteCodec(outboundCodec);
        this.privateHyperbee = privateHyperbee.sub(`inviteDb-${purpose}`);
    }

    getActiveDiscoveryKeys(): Promise<DiscoveryKeyUsages> {
        throw new Error('wip');
    }

    hasActiveInviteWithDiscoveryKey(key: Uint8Array): Promise<boolean> {
        throw new Error('wip');
    }

    async *getAllActiveOutbound(): AsyncIterable<InternalOutboundInvite<OutboundPayload>> {
        const stream = this.getAllOutbound();

        for await (const entry of stream) {
            if (isNotExpired(entry)) {
                yield entry;
            }
        }
    }

    async *getAllOutbound(): AsyncIterable<InternalOutboundInvite<OutboundPayload>> {
        const inviteRange = getInviteRange('outbound')

        const stream = this.privateHyperbee.createReadStream({gt: inviteRange.gt, let: inviteRange.lt}, {reverse: true});

        for await (const entry of stream) {
            const encodedValue = (entry as any).value;
            const item = decode(this.outboundInviteCodec, encodedValue)

            yield item;
        }
    }

    async getInboundInvite(inviteId: string): Promise<InternalInboundInvite<InboundPayload> | null> {
        const mappingKey = getKeyMappingKey(inviteId);

        const item = await this.privateHyperbee.get(mappingKey)

        if (item === null) {
            return null;
        }

        const invite = await this.privateHyperbee.get(item.value)

        if (invite === null) {
            return null;
        }

        const result = decode(this.inboundInviteCodec, invite.value);

        return result;
    }

    async getInvite(inviteId: string): Promise<InternalOutboundInvite<OutboundPayload> | InternalInboundInvite<InboundPayload> | null> {
        const mappingKey = getKeyMappingKey(inviteId);

        const item = await this.privateHyperbee.get(mappingKey)

        if (item === null) {
            return null;
        }

        const invite = await this.privateHyperbee.get(item.value)

        if (invite === null) {
            return null;
        }

        // TODO: make Codec that can deal with both inbound + outbound
        //const result = decode(this.outboundInviteCodec, invite.value);

        throw new Error('wip')
    }

    async deleteInvite(inviteId: string): Promise<void> {
        const mappingKey = getKeyMappingKey(inviteId);

        const item = await this.privateHyperbee.get(mappingKey)

        if (item !== null) {
            // TODO (robust): batch
            await this.privateHyperbee.del(item.value);
            await this.privateHyperbee.del(mappingKey);
        }
    }
    
    async isAlreadyUsed(outboundInviteId: string, sessionId: string): Promise<boolean> {
        const key = getInviteAcceptanceKey(outboundInviteId, sessionId)
        const existingItem = await this.privateHyperbee.get(key);

        return existingItem !== null;
    }

    async addInviteAcceptance(outboundInviteId: string, sessionId: string): Promise<InviteAcceptanceResult> {
        const key = getInviteAcceptanceKey(outboundInviteId, sessionId);
        const existingItem = await this.privateHyperbee.get(key);

        if (existingItem === null) {
            await this.privateHyperbee.put(key, encode(string, sessionId));

            return {
                outcome: 'added'
            }
        } else {
            return {
                outcome: 'duplicate'
            }
        }
    }

    async upsertInbound(invite: InternalInboundInvite<InboundPayload>): Promise<void> {
        const encodedRecord = encode(this.inboundInviteCodec, invite)
        const inviteKey = getKey(invite)

        // TODO (perf): batch
        await this.privateHyperbee.put(inviteKey, encodedRecord)
        await this.privateHyperbee.put(getKeyMappingKey(invite.inviteId), inviteKey)
    }

    async upsertOutbound(invite: InternalOutboundInvite<OutboundPayload>): Promise<void> {
        const encodedRecord = encode(this.outboundInviteCodec, invite)
        const inviteKey = getKey(invite)

        // TODO (perf): batch
        await this.privateHyperbee.put(inviteKey, encodedRecord)
        await this.privateHyperbee.put(getKeyMappingKey(invite.inviteId), inviteKey)
    }

    async *getAllActiveInbound(): AsyncGenerator<InternalInboundInvite<InboundPayload>> {
        const stream = this.getAllInbound();

        for await (const item of stream) {

            if (isNotExpired(item) && item.status !== 'complete' || item.status !== 'failed') {
                yield item;
            }
        }
    }

    async *getAllInbound(): AsyncIterable<InternalInboundInvite<InboundPayload>> {
        const inviteRange = getInviteRange('inbound')

        const stream = this.privateHyperbee.createReadStream({gt: inviteRange.gt, let: inviteRange.lt}, {reverse: true});

        for await (const entry of stream) {
            const encodedValue = (entry as any).value;
            const item = decode(this.inboundInviteCodec, encodedValue)

            if (isNotExpired(item) && item.status !== 'complete' || item.status !== 'failed') {
                yield item;
            }
        }
    }

}

function getKey(invite: InternalInboundInvite<unknown> | InternalOutboundInvite<unknown>): string {
    return `/invites/${invite.direction}/createdAt/${invite.createdAtMillisSinceEpoch}/${invite.inviteId}`
}

function getInviteAcceptanceKey(inviteId: string, sessionId: string): string {
    return `/invite_acceptance/${inviteId}/sessionId/${sessionId}`
}

function getKeyMappingKey(inviteId: string): string {
    return `/invite_key_mapping/${inviteId}`
}

function isNotExpired(invite: InternalInboundInvite<unknown> | InternalOutboundInvite<unknown>): Boolean {
   return invite.expiresMillisSinceEpoch == null || invite.expiresMillisSinceEpoch > Date.now()
}

function getInviteRange(direction: 'outbound' | 'inbound') {
    return {
        gt: `/invites/${direction}/createdAt`,
        lt: `/invites/${direction}/createdAt0`
    }
}