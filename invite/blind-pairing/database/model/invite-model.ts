import type { Codec, State } from "compact-encoding"
import {uint, uint8, string, buffer, fixed32} from 'compact-encoding/index.js'
import { stat } from "node:fs";

export type InviteId = string;

export type InternalOutboundInvite<Payload> = {
    direction: 'outbound',
    purpose: string,
    inviteId: InviteId,
    invite: Uint8Array,
    createdAtMillisSinceEpoch: number,
    publicKey: Uint8Array,
    discoveryKey: Uint8Array,
    key: Uint8Array,
    count: number | null,
    remaining: number | null,
    expiresMillisSinceEpoch: number | null,
    additionalData: {
        data:  Payload,
        signature: Uint8Array
    } | undefined
}

export type InternalInboundInvite<Payload> = {
    direction: 'inbound',
    purpose: string,
    inviteId: InviteId,
    invite: Uint8Array,
    createdAtMillisSinceEpoch: number,
    expiresMillisSinceEpoch: number | null,
    payload: Payload,
    status: 'pending' | 'complete' | 'failed'
}

const HAS_EXPIRES = 1
const HAS_COUNT = 2
const HAS_REMAINING = 4
const HAS_ADDITIONAL_DATA = 8;

const STATUSES = ['pending', 'complete', 'failed'] as const

const statusCodec: Codec<InternalInboundInvite<unknown>['status']> = {
    preencode: (state: State, value): void => {
        uint8.preencode(state, STATUSES.indexOf(value))
    },
    encode: (state: State, value): void => {
        const index = STATUSES.indexOf(value)
        if (index === -1) throw new Error(`Unknown invite status: ${value}`)
        uint8.encode(state, index)
    },
    decode: (state: State): InternalInboundInvite<unknown>['status'] => {
        const index = uint8.decode(state)
        const status = STATUSES[index]
        if (status === undefined) throw new Error(`Unknown invite status index: ${index}`)
        return status
    }
}

function directionCodec<T extends 'inbound' | 'outbound'>(t: T): Codec<T> {
    return {
        preencode: function (state: State, value: "outbound" | "inbound"): void {
            throw new Error("Function not implemented.");
        },
        encode: function (state: State, value: "outbound" | "inbound"): void {
            throw new Error("Function not implemented.");
        },
        decode: function (state: State): T {
            throw new Error("Function not implemented.");
        }
    }
}

const inboundCodec = directionCodec('inbound');
const outboundCodec = directionCodec('outbound')

export function createInviteCodec<InboundPayload, OutboundPayload>(
    inboundCodec: Codec<InboundPayload>,
    outboundCodec: Codec<OutboundPayload>): Codec<InternalInboundInvite<InboundPayload> | InternalOutboundInvite<OutboundPayload>> {

        const inboundInviteCodec = createInboundInviteCodec(inboundCodec);
        const outboundInviteCodec = createOutboundInviteCodec(outboundCodec); 

        return {
            decode(state: State): InternalInboundInvite<InboundPayload> | InternalOutboundInvite<OutboundPayload>  {
                // the flags come first but we don't need them
                uint.decode(state)
                
                const direction = string.decode(state)

                state.start = 0;

                if (direction === 'inbound') {
                    return inboundInviteCodec.decode(state)
                } else {
                    return outboundInviteCodec.decode(state)
                }
            },
            encode: (state: State, value: InternalInboundInvite<InboundPayload> | InternalOutboundInvite<OutboundPayload>): void => {
                if (value.direction === 'inbound') {
                    return inboundInviteCodec.encode(state, value);
                } else {
                    return outboundInviteCodec.encode(state, value);
                }

            },
            preencode: (state: State, value: InternalInboundInvite<InboundPayload> | InternalOutboundInvite<OutboundPayload>): void => {
                if (value.direction === 'inbound') {
                    return inboundInviteCodec.preencode(state, value);
                } else {
                    return outboundInviteCodec.preencode(state, value);
                }
            }
        }
    }


export function createInboundInviteCodec<Payload>(payloadCodec: Codec<Payload>): Codec<InternalInboundInvite<Payload>> {
    return {
        decode:(state: State): InternalInboundInvite<Payload> => {
            const flags = uint.decode(state)

            return {
                direction: inboundCodec.decode(state),
                purpose: string.decode(state),
                inviteId: string.decode(state),
                invite: buffer.decode(state),
                createdAtMillisSinceEpoch: uint.decode(state),
                expiresMillisSinceEpoch: (flags & HAS_EXPIRES) ? uint.decode(state) : null,
                payload: payloadCodec.decode(state),
                status: statusCodec.decode(state)
            }
        },
        encode: (state: State, value: InternalInboundInvite<Payload>): void => {
            uint.encode(state, inboundFlags(value))
            inboundCodec.encode(state, value.direction)
            string.encode(state, value.purpose)
            string.encode(state, value.inviteId)
            buffer.encode(state, value.invite)
            uint.encode(state, value.createdAtMillisSinceEpoch)
            if (value.expiresMillisSinceEpoch !== null) uint.encode(state, value.expiresMillisSinceEpoch)
            payloadCodec.encode(state, value.payload)
            statusCodec.encode(state, value.status)
        },
        preencode: (state: State, value: InternalInboundInvite<Payload>): void => {
            uint.preencode(state, inboundFlags(value))
            inboundCodec.preencode(state, value.direction)
            string.preencode(state, value.purpose)
            string.preencode(state, value.inviteId)
            buffer.preencode(state, value.invite)
            uint.preencode(state, value.createdAtMillisSinceEpoch)
            if (value.expiresMillisSinceEpoch !== null) uint.preencode(state, value.expiresMillisSinceEpoch)
            payloadCodec.preencode(state, value.payload)
            statusCodec.preencode(state, value.status)
        }
    }
}

export function createOutboundInviteCodec<Payload>(payloadCodec: Codec<Payload>): Codec<InternalOutboundInvite<Payload>> {
    return {
        decode:(state: State): InternalOutboundInvite<Payload> => {
            const flags = uint.decode(state)

            return {
                direction: outboundCodec.decode(state),
                purpose: string.decode(state),
                inviteId: string.decode(state),
                invite: buffer.decode(state),
                createdAtMillisSinceEpoch: uint.decode(state),
                publicKey: fixed32.decode(state),
                discoveryKey: fixed32.decode(state),
                key: fixed32.decode(state),
                count: (flags & HAS_COUNT) ? uint.decode(state) : null,
                remaining: (flags & HAS_REMAINING) ? uint.decode(state) : null,
                expiresMillisSinceEpoch: (flags & HAS_EXPIRES) ? uint.decode(state) : null,
                additionalData: flags & HAS_ADDITIONAL_DATA ? {
                    data: payloadCodec.decode(state),
                    signature: fixed32.decode(state)
                } : undefined
            }
        },
        encode: (state: State, value: InternalOutboundInvite<Payload>): void => {
            uint.encode(state, outboundFlags(value))
            outboundCodec.encode(state, value.direction)
            string.encode(state, value.purpose)
            string.encode(state, value.inviteId)
            buffer.encode(state, value.invite)
            uint.encode(state, value.createdAtMillisSinceEpoch)
            fixed32.encode(state, value.publicKey)
            fixed32.encode(state, value.discoveryKey)
            fixed32.encode(state, value.key)
            if (value.count !== null) uint.encode(state, value.count)
            if (value.remaining !== null) uint.encode(state, value.remaining)
            if (value.expiresMillisSinceEpoch !== null) uint.encode(state, value.expiresMillisSinceEpoch)
            if (value.additionalData) payloadCodec.encode(state, value.additionalData.data)
            if (value.additionalData) fixed32.encode(state, value.additionalData.signature)
        },
        preencode: (state: State, value: InternalOutboundInvite<Payload>): void => {
            uint.preencode(state, outboundFlags(value))
            outboundCodec.preencode(state, value.direction),
            string.preencode(state, value.purpose)
            string.preencode(state, value.inviteId)
            buffer.preencode(state, value.invite)
            uint.preencode(state, value.createdAtMillisSinceEpoch)
            fixed32.preencode(state, value.publicKey)
            fixed32.preencode(state, value.discoveryKey)
            fixed32.preencode(state, value.key);
            if (value.count !== null) uint.preencode(state, value.count)
            if (value.remaining !== null) uint.preencode(state, value.remaining)
            if (value.expiresMillisSinceEpoch !== null) uint.preencode(state, value.expiresMillisSinceEpoch)
            if (value.additionalData) payloadCodec.preencode(state, value.additionalData.data)
            if (value.additionalData) fixed32.preencode(state, value.additionalData.signature)
        }
    }
}

function inboundFlags(value: InternalInboundInvite<unknown>): number {
    return value.expiresMillisSinceEpoch !== null ? HAS_EXPIRES : 0
}

function outboundFlags(value: InternalOutboundInvite<unknown>): number {
    return (value.expiresMillisSinceEpoch !== null ? HAS_EXPIRES : 0) |
        (value.count !== null ? HAS_COUNT : 0) |
        (value.remaining !== null ? HAS_REMAINING : 0) |
        (value.additionalData ? HAS_ADDITIONAL_DATA : 0) 
}
