import type { Codec } from "compact-encoding"
import {encode, decode, string} from 'compact-encoding/index.js'
import { type OutboundInvite, type InboundInvite, createOutboundInviteCodec, createInboundInviteCodec } from "../model.js"
import Hyperbee from "hyperbee"

export type InviteAcceptanceResult = {
    outcome: 'added' | 'duplicate'
}

export interface IInviteDatabase<InboundPayload, OutboundPayload> {
    upsertOutbound(invite: OutboundInvite<OutboundPayload>): Promise<void>
    upsertInbound(invite: InboundInvite<InboundPayload>): Promise<void>

    deleteOutboundInvite(inviteId: string): Promise<void>

    addInviteAcceptance(outboundInviteId: string, sessionId: string): Promise<InviteAcceptanceResult>
    isAlreadyUsed(outboundInviteId: string, sessionId: string): Promise<boolean>;

    getAllActiveOutbound(): AsyncIterable<OutboundInvite<OutboundPayload>>
    getAllActiveInbound(): AsyncIterable<InboundInvite<InboundPayload>>
};

export class BTreeInviteDatabase<OutboundPayload, InboundPayload> implements IInviteDatabase<InboundPayload, OutboundPayload> {
    private inboundInviteCodec: Codec<InboundInvite<InboundPayload>>;
    private outboundInviteCodec: Codec<OutboundInvite<OutboundPayload>>;
    private privateHyperbee: Hyperbee;

    /**
     * @param privateHyperbee A hyperbee database (not replicated) to store the invite. This should be a hyperbee sub-database to avoid conflicts.
     * @param codec A codec for encoding / decoding the payloads sent on invite acceptances in each direction
     */
    constructor(privateHyperbee: Hyperbee, inboundCodec: Codec<InboundPayload>, outboundCodec: Codec<OutboundPayload>) {
        this.inboundInviteCodec = createInboundInviteCodec(inboundCodec);
        this.outboundInviteCodec = createOutboundInviteCodec(outboundCodec);
        this.privateHyperbee = privateHyperbee;
    }

    async deleteOutboundInvite(inviteId: string): Promise<void> {
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

    async upsertInbound(invite: InboundInvite<InboundPayload>): Promise<void> {
        const encodedRecord = encode(this.inboundInviteCodec, invite)
        const inviteKey = getKey(invite)

        // TODO (perf): batch
        await this.privateHyperbee.put(inviteKey, encodedRecord)
        await this.privateHyperbee.put(getKeyMappingKey(invite.inviteId), inviteKey)
    }

    async upsertOutbound(invite: OutboundInvite<OutboundPayload>): Promise<void> {
        const encodedRecord = encode(this.outboundInviteCodec, invite)
        const inviteKey = getKey(invite)

        // TODO (perf): batch
        await this.privateHyperbee.put(inviteKey, encodedRecord)
        await this.privateHyperbee.put(getKeyMappingKey(invite.inviteId), inviteKey)
    }

    async *getAllActiveOutbound(): AsyncGenerator<OutboundInvite<OutboundPayload>> {
        const inviteRange = getInviteRange('outbound')

        const stream = this.privateHyperbee.createReadStream({gt: inviteRange.gt, let: inviteRange.lt}, {reverse: true});

        for await (const entry of stream) {
            const encodedValue = (entry as any).value;
            const item = decode(this.outboundInviteCodec, encodedValue)

            if ( (!item.remaining || item.remaining > 0) && isNotExpired(item)) {
                yield item;
            }
        }
    }

    async *getAllActiveInbound(): AsyncGenerator<InboundInvite<InboundPayload>> {
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

function getKey(invite: InboundInvite<unknown> | OutboundInvite<unknown>): string {
    return `/invites/${invite.direction}/createdAt/${invite.createdAtMillisSinceEpoch}/${invite.inviteId}`
}

function getInviteAcceptanceKey(inviteId: string, sessionId: string): string {
    return `/invite_acceptance/${inviteId}/sessionId/${sessionId}`
}

function getKeyMappingKey(inviteId: string): string {
    return `/invite_key_mapping/${inviteId}`
}

function isNotExpired(invite: InboundInvite<unknown> | OutboundInvite<unknown>): Boolean {
   return invite.expiresMillisSinceEpoch == null || invite.expiresMillisSinceEpoch > Date.now()
}

function getInviteRange(direction: 'outbound' | 'inbound') {
    return {
        gt: `/invites/${direction}/createdAt`,
        lt: `/invites/${direction}/createdAt0`
    }
}