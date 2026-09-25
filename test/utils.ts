import Hyperswarm, { type BootstrapNode } from 'hyperswarm'
import { InviteManager } from '../src/invite/blind-pairing/invite-manager.js'
import { MultiplexedBlindPeering } from '../src/invite/blind-pairing/multiplexed-blind-pairing.js'
import type { Codec } from 'compact-encoding'
import {
    BTreeInviteDatabase,
    type IInviteDatabase,
} from '../src/invite/blind-pairing/database/invite-database.js'
import Corestore from 'corestore'
import Hyperbee from 'hyperbee'
import { randomBytes } from 'node:crypto'
import createTestnet from 'hyperdht/testnet.js'

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
    db: IInviteDatabase<Inbound, Outbound>
    mbp: MultiplexedBlindPeering
}> {
    const mbp = new MultiplexedBlindPeering(
        new Hyperswarm({ bootstrap: bootstrap })
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

    const db = new BTreeInviteDatabase<Inbound, Outbound>(
        hyperbee,
        purpose,
        inboundCodec,
        outboundCodec
    )

    const inviteManager = new InviteManager<Inbound, Outbound>(
        mbp,
        purpose,
        db,
        inboundCodec,
        outboundCodec
    )

    return { inviteManager, db, mbp }
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
