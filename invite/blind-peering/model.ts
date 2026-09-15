import type { Codec, State } from "compact-encoding"
import {uint, uint8, string, buffer, fixed32} from 'compact-encoding/index.js'

export type OutboundInvite<Payload> = {
    direction: 'outbound',
    inviteId: string,
    invite: Uint8Array,
    createdAtMillisSinceEpoch: number,
    publicKey: Uint8Array,
    discoveryKey: Uint8Array,
    count: number | null,
    remaining: number | null,
    expiresMillisSinceEpoch: number | null,
    payload: Payload
}

export type InboundInvite<Payload> = {
    direction: 'inbound',
    inviteId: string,
    invite: Uint8Array,
    createdAtMillisSinceEpoch: number,
    expiresMillisSinceEpoch: number | null,
    payload: Payload,
    inviteCode: Uint8Array,
    status: 'pending' | 'complete' | 'failed'
}

// Bit flags marking which nullable fields are present in an encoded record
const HAS_EXPIRES = 1
const HAS_COUNT = 2
const HAS_REMAINING = 4

const STATUSES = ['pending', 'complete', 'failed'] as const

const statusCodec: Codec<InboundInvite<unknown>['status']> = {
    preencode: (state: State, value): void => {
        uint8.preencode(state, STATUSES.indexOf(value))
    },
    encode: (state: State, value): void => {
        const index = STATUSES.indexOf(value)
        if (index === -1) throw new Error(`Unknown invite status: ${value}`)
        uint8.encode(state, index)
    },
    decode: (state: State): InboundInvite<unknown>['status'] => {
        const index = uint8.decode(state)
        const status = STATUSES[index]
        if (status === undefined) throw new Error(`Unknown invite status index: ${index}`)
        return status
    }
}

export function createInboundInviteCodec<Payload>(payloadCodec: Codec<Payload>): Codec<InboundInvite<Payload>> {
    return {
        decode:(state: State): InboundInvite<Payload> => {
            const flags = uint.decode(state)

            return {
                direction: 'inbound',
                inviteId: string.decode(state),
                invite: buffer.decode(state),
                createdAtMillisSinceEpoch: uint.decode(state),
                expiresMillisSinceEpoch: (flags & HAS_EXPIRES) ? uint.decode(state) : null,
                payload: payloadCodec.decode(state),
                inviteCode: buffer.decode(state),
                status: statusCodec.decode(state)
            }
        },
        encode: (state: State, value: InboundInvite<Payload>): void => {
            uint.encode(state, inboundFlags(value))
            string.encode(state, value.inviteId)
            buffer.encode(state, value.invite)
            uint.encode(state, value.createdAtMillisSinceEpoch)
            if (value.expiresMillisSinceEpoch !== null) uint.encode(state, value.expiresMillisSinceEpoch)
            payloadCodec.encode(state, value.payload)
            buffer.encode(state, value.inviteCode)
            statusCodec.encode(state, value.status)
        },
        preencode: (state: State, value: InboundInvite<Payload>): void => {
            uint.preencode(state, inboundFlags(value))
            string.preencode(state, value.inviteId)
            buffer.preencode(state, value.invite)
            uint.preencode(state, value.createdAtMillisSinceEpoch)
            if (value.expiresMillisSinceEpoch !== null) uint.preencode(state, value.expiresMillisSinceEpoch)
            payloadCodec.preencode(state, value.payload)
            buffer.preencode(state, value.inviteCode)
            statusCodec.preencode(state, value.status)
        }
    }
}

export function createOutboundInviteCodec<Payload>(payloadCodec: Codec<Payload>): Codec<OutboundInvite<Payload>> {
    return {
        decode:(state: State): OutboundInvite<Payload> => {
            const flags = uint.decode(state)

            return {
                direction: 'outbound',
                inviteId: string.decode(state),
                invite: buffer.decode(state),
                createdAtMillisSinceEpoch: uint.decode(state),
                publicKey: fixed32.decode(state),
                discoveryKey: fixed32.decode(state),
                count: (flags & HAS_COUNT) ? uint.decode(state) : null,
                remaining: (flags & HAS_REMAINING) ? uint.decode(state) : null,
                expiresMillisSinceEpoch: (flags & HAS_EXPIRES) ? uint.decode(state) : null,
                payload: payloadCodec.decode(state)
            }
        },
        encode: (state: State, value: OutboundInvite<Payload>): void => {
            uint.encode(state, outboundFlags(value))
            string.encode(state, value.inviteId)
            buffer.encode(state, value.invite)
            uint.encode(state, value.createdAtMillisSinceEpoch)
            fixed32.encode(state, value.publicKey)
            fixed32.encode(state, value.discoveryKey)
            if (value.count !== null) uint.encode(state, value.count)
            if (value.remaining !== null) uint.encode(state, value.remaining)
            if (value.expiresMillisSinceEpoch !== null) uint.encode(state, value.expiresMillisSinceEpoch)
            payloadCodec.encode(state, value.payload)
        },
        preencode: (state: State, value: OutboundInvite<Payload>): void => {
            uint.preencode(state, outboundFlags(value))
            string.preencode(state, value.inviteId)
            buffer.preencode(state, value.invite)
            uint.preencode(state, value.createdAtMillisSinceEpoch)
            fixed32.preencode(state, value.publicKey)
            fixed32.preencode(state, value.discoveryKey)
            if (value.count !== null) uint.preencode(state, value.count)
            if (value.remaining !== null) uint.preencode(state, value.remaining)
            if (value.expiresMillisSinceEpoch !== null) uint.preencode(state, value.expiresMillisSinceEpoch)
            payloadCodec.preencode(state, value.payload)
        }
    }
}

function inboundFlags(value: InboundInvite<unknown>): number {
    return value.expiresMillisSinceEpoch !== null ? HAS_EXPIRES : 0
}

function outboundFlags(value: OutboundInvite<unknown>): number {
    return (value.expiresMillisSinceEpoch !== null ? HAS_EXPIRES : 0) |
        (value.count !== null ? HAS_COUNT : 0) |
        (value.remaining !== null ? HAS_REMAINING : 0)
}
