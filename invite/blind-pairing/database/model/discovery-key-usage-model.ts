import type { Codec } from "compact-encoding"

export type DiscoveryKeyUsages = {
    purpose: string,
    keys: Array<{
        discoveryKey: Uint8Array,
        count: number
    }>,
    lastExpiryMillisSinceEpoch: number
}

export const discoveryKeyUsageCodec: Codec<DiscoveryKeyUsages> = {
    
}