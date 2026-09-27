import Hyperswarm, { type BootstrapNode } from 'hyperswarm'
import { InviteManager } from '../src/invite/blind-pairing/manager/invite-manager.js'
import { SharedBlindPairing } from '../src/invite/blind-pairing/manager/shared-blind-pairing.js'
import type { Codec } from 'compact-encoding'
import Corestore from 'corestore'
import Hyperbee from 'hyperbee'
import { randomBytes } from 'node:crypto'
import createTestnet from 'hyperdht/testnet.js'
import BlindPairing from 'blind-pairing'

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
    outboundCodec: Codec<Outbound>
): Promise<{
    inviteManager: InviteManager<Inbound, Outbound>
    mbp: SharedBlindPairing
}> {
    const mbp = new SharedBlindPairing(
        new BlindPairing(new Hyperswarm({ bootstrap: bootstrap }))
    )

    const randomCoreName = randomBytes(20).toString('hex')

    await corestore.ready()
    const hypercore = corestore.get({ name: randomCoreName })
    await hypercore.ready()

    const hyperbee: Hyperbee = new Hyperbee(hypercore as any, {
        keyEncoding: 'utf-8',
        valueEncoding: 'binary',
    })
    await hyperbee.ready()

    const inviteManager = new InviteManager<Inbound, Outbound>(
        mbp,
        purpose,
        hyperbee,
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
        outboundCodec
    )
    const outbound = await createTestDependencies(
        bootstrap,
        corestore,
        purpose,
        inboundCodec,
        outboundCodec
    )

    await inbound.inviteManager.ready()
    await outbound.inviteManager.ready()

    return {
        inviter: inbound,
        invitee: outbound,
    }
}
