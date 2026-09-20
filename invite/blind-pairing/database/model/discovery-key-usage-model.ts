import type { Codec, State } from "compact-encoding"

export type DiscoveryKeyUsages = {
    purpose: string,
    keys: Array<{
        discoveryKey: Uint8Array,
        count: number
    }>,
    lastExpiryMillisSinceEpoch: number
}

export const discoveryKeyUsageCodec: Codec<DiscoveryKeyUsages> = {
    preencode: function (state: State, value: DiscoveryKeyUsages): void {
        throw new Error("Function not implemented.")
    },
    encode: function (state: State, value: DiscoveryKeyUsages): void {
        throw new Error("Function not implemented.")
    },
    decode: function (state: State): DiscoveryKeyUsages {
        throw new Error("Function not implemented.")
    }
}