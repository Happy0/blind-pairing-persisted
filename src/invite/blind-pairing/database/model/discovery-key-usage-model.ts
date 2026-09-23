export type DiscoveryKeyUsages = {
    keys: Array<{
        discoveryKey: Uint8Array
        count: number
    }>
    lastExpiryMillisSinceEpoch: number | null
}
