import type { Codec } from "compact-encoding"
import {encode, decode, string} from 'compact-encoding/index.js'
import { type OutboundInvite, type InboundInvite, createOutboundInviteCodec, createInboundInviteCodec } from "../model.js"
import Hyperbee from "hyperbee"

export type InviteAcceptanceResult = {
    outcome: 'added' | 'duplicate'
}

export interface IInviteDatabase<OutboundPayload, InboundPayload> {
    upsertOutbound(invite: OutboundInvite<OutboundPayload>): Promise<void>
    upsertInbound(invite: InboundInvite<InboundPayload>): Promise<void>

    addInviteAcceptance(invite: OutboundInvite<OutboundPayload>, sessionId: string): Promise<InviteAcceptanceResult>
    isAlreadyUsed(invite: OutboundInvite<OutboundPayload>, sessionId: string): Promise<boolean>;

    getAllActiveOutbound(): AsyncIterator<OutboundInvite<OutboundPayload>>
    getAllActiveInbound(): AsyncIterator<InboundInvite<InboundPayload>>
};

export class BTreeInviteDatabase<OutboundPayload, InboundPayload> implements IInviteDatabase<OutboundPayload, InboundPayload> {
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
    
    async isAlreadyUsed(invite: OutboundInvite<OutboundPayload>, sessionId: string): Promise<boolean> {
        const key = `${getKey(invite)}/sessionId/${sessionId}`
        const existingItem = await this.privateHyperbee.get(key);

        return existingItem !== null;
    }

    async addInviteAcceptance(invite: OutboundInvite<OutboundPayload>, sessionId: string): Promise<InviteAcceptanceResult> {
        const key = `${getKey(invite)}/sessionId/${sessionId}`
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

        await this.privateHyperbee.put(inviteKey, encodedRecord)
    }

    async upsertOutbound(invite: OutboundInvite<OutboundPayload>): Promise<void> {
        const encodedRecord = encode(this.outboundInviteCodec, invite)
        const inviteKey = getKey(invite)

        await this.privateHyperbee.put(inviteKey, encodedRecord)
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

    async *getAllActiveInbound(): AsyncIterator<InboundInvite<InboundPayload>> {
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

function isNotExpired(invite: InboundInvite<unknown> | OutboundInvite<unknown>): Boolean {
   return invite.expiresMillisSinceEpoch == null || invite.expiresMillisSinceEpoch > Date.now()
}

function getInviteRange(direction: 'outbound' | 'inbound') {
    return {
        gt: `/invites/${direction}/createdAt`,
        lt: `/invites/${direction}/createdAt0`
    }
}