import Hyperswarm, { type BootstrapNode } from 'hyperswarm'
import { InviteManager } from '../src/invite/blind-pairing/manager/invite-manager.js'
import { SharedBlindPairing } from '../src/invite/blind-pairing/manager/shared-blind-pairing.js'
import type { Codec } from 'compact-encoding'
import Corestore from 'corestore'
import Hyperbee from 'hyperbee'
import { randomBytes } from 'node:crypto'
import createTestnet from 'hyperdht/testnet.js'
import BlindPairing from 'blind-pairing'
import { BTreeInviteDatabase } from '../src/index.js'

export async function getTestnetHyperswarm(): Promise<Array<BootstrapNode>> {
    const testnet = await createTestnet(10)
    const bootstrap = testnet.bootstrap

    return [...bootstrap]
}

export async function createTestDependencies<Inbound, Outbound>(
    bootstrap: Array<BootstrapNode>,
    corestore: Corestore,
    purpose: string,
    inboundCodec: Codec<Inbound>,
    outboundCodec: Codec<Outbound>,
    hypercoreName: string
): Promise<{
    inviteManager: InviteManager<Inbound, Outbound>
    mbp: SharedBlindPairing
}> {
    const mbp = new SharedBlindPairing(
        new BlindPairing(new Hyperswarm({ bootstrap: bootstrap }))
    )

    await corestore.ready()
    const hypercore = corestore.get({ name: hypercoreName })
    await hypercore.ready()

    const hyperbee: Hyperbee = new Hyperbee(hypercore as any, {
        keyEncoding: 'utf-8',
        valueEncoding: 'binary',
    })
    await hyperbee.ready()

    const inviteDatabase = new BTreeInviteDatabase<Inbound, Outbound>(hyperbee, purpose, inboundCodec, outboundCodec);

    const inviteManager = new InviteManager<Inbound, Outbound>(
        mbp,
        purpose,
        inviteDatabase,
        inboundCodec,
        outboundCodec
    )

    return { inviteManager, mbp }
}

export async function createInviteManagers<Inbound, Outbound>(
    bootstrap: Array<BootstrapNode>,
    corestore: Corestore,
    purpose: string,
    inboundCodec: Codec<Inbound>,
    outboundCodec: Codec<Outbound>
) {
    const inbound = await createTestDependencies(
        bootstrap,
        corestore,
        purpose,
        inboundCodec,
        outboundCodec,
        randomBytes(20).toString('hex')
    )
    const outbound = await createTestDependencies(
        bootstrap,
        corestore,
        purpose,
        inboundCodec,
        outboundCodec,
        randomBytes(20).toString('hex')
    )

    await inbound.inviteManager.ready()
    await outbound.inviteManager.ready()

    return {
        inviter: inbound,
        invitee: outbound,
    }
}
