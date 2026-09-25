import ReadyResource from 'ready-resource'
import type { IInviteDatabase } from '../database/invite-database.js'
import type { InviteUpdateEvent } from './invite-update-event.js'
import {
    type InternalOutboundInvite,
    type InternalInboundInvite,
} from '../database/model/invite-model.js'
import BlindPairing from 'blind-pairing'
import { type AddressInput } from 'compact-encoding/index.js'
import { encode, type Codec } from 'compact-encoding'
import b4a from 'b4a'
import type { MultiplexedBlindPeering } from './multiplexed-blind-pairing.js'
import { SequentialRunner } from '../utils/sequential-runner.js'
import { EventEmitter } from 'tseep'

export type Invite = {
    invite: Uint8Array
    purpose: string
}

export interface IInviteManager<InboundPayload, OutboundPayload> {
    createInvite(
        key: Uint8Array,
        count: number,
        expiresMillisSinceEpoch: number | null,
        payload: OutboundPayload
    ): Promise<Invite>

    useInvite(InboundInvite: Invite, payload: InboundPayload): Promise<void>

    deleteInvite(inviteId: string): Promise<void>

    events: EventEmitter<InviteUpdateEvent<InboundPayload, OutboundPayload>>
}

export class InviteManager<InboundAdditionalData, OutboundAdditionalData>
    extends ReadyResource
    implements IInviteManager<InboundAdditionalData, OutboundAdditionalData>
{
    private purpose: string
    private inviteDatabase: IInviteDatabase<
        InboundAdditionalData,
        OutboundAdditionalData
    >
    private multiplexedBlindPeering: MultiplexedBlindPeering

    private inboundInviteCodec: Codec<InboundAdditionalData>
    private outboundInviteCodec: Codec<OutboundAdditionalData>

    private sequentialRunner: SequentialRunner = new SequentialRunner()

    public events: EventEmitter<
        InviteUpdateEvent<InboundAdditionalData, OutboundAdditionalData>
    > = new EventEmitter<
        InviteUpdateEvent<InboundAdditionalData, OutboundAdditionalData>
    >()

    constructor(
        multiplexedBlindPeering: MultiplexedBlindPeering,
        purpose: string,
        inviteDatabase: IInviteDatabase<
            InboundAdditionalData,
            OutboundAdditionalData
        >,
        inboundCodec: Codec<InboundAdditionalData>,
        outboundCodec: Codec<OutboundAdditionalData>
    ) {
        super()
        this.purpose = purpose
        this.inviteDatabase = inviteDatabase

        this.multiplexedBlindPeering = multiplexedBlindPeering

        this.inboundInviteCodec = inboundCodec
        this.outboundInviteCodec = outboundCodec
    }

    protected override async _open(): Promise<void> {
        const inboundDiscoveryKeys = this.inviteDatabase.getAllActiveInbound()
        const outboundDiscoveryKeys =
            await this.inviteDatabase.getActiveDiscoveryKeys()

        await this.multiplexedBlindPeering.ready()

        for (const key of outboundDiscoveryKeys.keys) {
            this.multiplexedBlindPeering.addOutboundInviteHandler({
                database: this.inviteDatabase,
                discoveryKey: key.discoveryKey,
                expiresMillisSinceEpoch:
                    outboundDiscoveryKeys.lastExpiryMillisSinceEpoch,
                purpose: this.purpose,
                eventEmitter: this.events,
                inboundCodec: this.inboundInviteCodec,
                outboundCodec: this.outboundInviteCodec,
            })
        }

        for await (const inbound of inboundDiscoveryKeys) {
            const { discoveryKey } = (BlindPairing as any).decodeInvite(
                inbound.invite
            )
            this.acceptInvite(inbound, discoveryKey)
        }
    }

    protected override async _close(): Promise<void> {
        this.events.removeAllListeners()

        const outboundDiscoveryKeys =
            await this.inviteDatabase.getActiveDiscoveryKeys()

        for (const key of outboundDiscoveryKeys.keys) {
            this.multiplexedBlindPeering.removeOutboundInviteHandler(
                key.discoveryKey,
                this.purpose
            )
        }

        this.multiplexedBlindPeering.removeInboundHandlers(this.purpose)
    }

    async deleteInvite(inviteId: string): Promise<void> {
        const invite = await this.inviteDatabase.getInvite(inviteId)

        if (!invite) {
            return
        }

        if (invite.direction === 'inbound') {
            await this.sequentialRunner.runSequentiallyPerId(
                inviteId,
                async () => {
                    await this.inviteDatabase.deleteInvite(inviteId)
                    await this.multiplexedBlindPeering.removeInboundInvite(
                        inviteId
                    )
                }
            )
        } else {
            const discoveryKeyHex = b4a.toString(invite.discoveryKey, 'hex')

            // Sequence with the invite insert function
            await this.sequentialRunner.runSequentiallyPerId(
                discoveryKeyHex,
                async () => {
                    await this.inviteDatabase.deleteInvite(inviteId)
                    const discoveryKeyInUse =
                        await this.inviteDatabase.hasActiveOutboundInviteWithDiscoveryKey(
                            invite.discoveryKey
                        )

                    if (!discoveryKeyInUse) {
                        await this.multiplexedBlindPeering.removeOutboundInviteHandler(
                            invite.discoveryKey,
                            invite.purpose
                        )
                    }
                }
            )
        }
    }

    async createInvite(
        key: Uint8Array,
        count: number,
        expiresMillisSinceEpoch: number | null,
        payload: OutboundAdditionalData,
        additionalNodes?: Array<AddressInput>
    ): Promise<InternalOutboundInvite<OutboundAdditionalData>> {
        // TODO: add expires
        const additionalData = encode(this.outboundInviteCodec, payload)

        let opts: any = { data: additionalData }
        opts = additionalNodes
            ? { ...opts, additionalNodes: additionalNodes }
            : opts

        const invite = BlindPairing.createInvite(key, opts)
        const inviteId = b4a.toString(invite.id, 'hex')

        const additionalDataSignature = invite.additional?.signature

        const outboundInvite: InternalOutboundInvite<OutboundAdditionalData> = {
            count: count,
            createdAtMillisSinceEpoch: Date.now(),
            direction: 'outbound',
            discoveryKey: invite.discoveryKey,
            expiresMillisSinceEpoch: expiresMillisSinceEpoch,
            additionalData:
                payload !== null && payload !== undefined
                    ? {
                          data: payload,
                          // The signature should never be undefined if 'payload' is not null or undefined
                          signature: additionalDataSignature!,
                      }
                    : {
                          data: payload,
                          signature: null,
                      },
            invite: invite.invite,
            inviteId: inviteId,
            key: key,
            publicKey: invite.publicKey,
            purpose: this.purpose,
            remaining: count,
        }

        const discoveryKeyHex = b4a.toString(invite.discoveryKey, 'hex')

        // Sequence with the invite deletion function
        await this.sequentialRunner.runSequentiallyPerId(
            discoveryKeyHex,
            async () => {
                await this.inviteDatabase.upsertOutbound(outboundInvite)
                this.listenForInviteAcceptance(outboundInvite)
            }
        )

        return outboundInvite
    }

    async useInvite(
        invite: Invite,
        payload: InboundAdditionalData
    ): Promise<void> {
        // TODO (robust): add decode invite function to holepunch types
        const decodedInvite = (BlindPairing as any).decodeInvite(invite.invite)

        const inviteId = b4a.toString(decodedInvite.id, 'hex')

        const inboundInvite: InternalInboundInvite<InboundAdditionalData> = {
            createdAtMillisSinceEpoch: Date.now(),
            direction: 'inbound',
            invite: invite.invite,
            expiresMillisSinceEpoch: decodedInvite.expires,
            purpose: invite.purpose,
            status: 'pending',
            inviteId: b4a.toString(decodedInvite.id, 'hex'),
            payload: payload,
        }

        await this.sequentialRunner.runSequentiallyPerId(inviteId, async () => {
            await this.inviteDatabase.upsertInbound(inboundInvite)
            await this.acceptInvite(inboundInvite, decodedInvite.discoveryKey)
        })
    }

    private async acceptInvite(
        inbound: InternalInboundInvite<InboundAdditionalData>,
        discoveryKey: Uint8Array
    ): Promise<void> {
        await this.multiplexedBlindPeering.addInboundInviteHandler({
            database: this.inviteDatabase,
            invite: inbound,
            eventEmitter: this.events,
            inboundCodec: this.inboundInviteCodec,
            outboundCodec: this.outboundInviteCodec,
            discoveryKey: discoveryKey,
        })
    }

    private listenForInviteAcceptance(
        invite: InternalOutboundInvite<OutboundAdditionalData>
    ): void {
        this.multiplexedBlindPeering.addOutboundInviteHandler({
            database: this.inviteDatabase,
            discoveryKey: invite.discoveryKey,
            expiresMillisSinceEpoch: invite.expiresMillisSinceEpoch,
            purpose: invite.purpose,
            eventEmitter: this.events,
            inboundCodec: this.inboundInviteCodec,
            outboundCodec: this.outboundInviteCodec,
        })
    }
}
