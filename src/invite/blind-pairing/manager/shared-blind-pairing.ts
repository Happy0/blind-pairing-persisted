import BlindPairing, { type Candidate, type Member } from 'blind-pairing'
import type Hyperswarm from 'hyperswarm'
import type { InviteUpdateEvent } from './invite-update-event.js'
import type { IInviteDatabase } from '../database/invite-datastore.js'
import ReadyResource from 'ready-resource'
import type { InternalInboundInvite } from '../database/model/invite-model.js'
import b4a from 'b4a'
import { decode, encode, type Codec } from 'compact-encoding'
import { SequentialRunner } from '../utils/sequential-runner.js'
import { EventEmitter } from 'tseep'

export type InboundInviteHandlerOpts<InboundPayload, OutboundPayload> = {
    invite: InternalInboundInvite<InboundPayload>
    discoveryKey: Uint8Array
    database: IInviteDatabase<InboundPayload, OutboundPayload>
    eventEmitter: EventEmitter<
        InviteUpdateEvent<InboundPayload, OutboundPayload>
    >
    inboundCodec: Codec<InboundPayload>
    outboundCodec: Codec<OutboundPayload>
}

export type OutboundInviteHandlerOpts<InboundPayload, OutboundPayload> = {
    discoveryKey: Uint8Array
    purpose: string
    expiresMillisSinceEpoch: number | null
    database: IInviteDatabase<InboundPayload, OutboundPayload>
    eventEmitter: EventEmitter<
        InviteUpdateEvent<InboundPayload, OutboundPayload>
    >
    inboundCodec: Codec<InboundPayload>
    outboundCodec: Codec<OutboundPayload>
}

type OutboundHandlerEntry = {
    handlers: Array<OutboundInviteHandlerOpts<unknown, unknown>>
    member: Member
}

type InboundHandlerEntry = {
    queue: Array<InboundInviteHandlerOpts<unknown, unknown>>
    current: {
        candidate: Candidate
        item: InboundInviteHandlerOpts<unknown, unknown>
    }
}

export class SharedBlindPairing extends ReadyResource {
    private blindPairing: BlindPairing

    private sequentialRunner: SequentialRunner

    private outboundHandlers: Record<string, OutboundHandlerEntry> = {}
    private inboundHandlers: Record<string, InboundHandlerEntry> = {}

    private timerTask: NodeJS.Timeout | null = null

    constructor(blindPairing: BlindPairing) {
        super()

        this.sequentialRunner = new SequentialRunner()
        this.blindPairing = blindPairing
    }

    public async addInboundInviteHandler<InboundPayload, OutboundPayload>(
        inboundHandlerOpts: InboundInviteHandlerOpts<
            InboundPayload,
            OutboundPayload
        >
    ): Promise<void> {
        const discoveryKeyHex = b4a.toString(
            inboundHandlerOpts.discoveryKey,
            'hex'
        )

        const existingEntry = this.inboundHandlers[discoveryKeyHex]

        if (!existingEntry) {
            this.handleNextIncoming(discoveryKeyHex, inboundHandlerOpts)
        } else {
            // blind-pairing can only handle one 'addCandidate' for a given discovery key at a time
            existingEntry.queue.push(
                inboundHandlerOpts as InboundInviteHandlerOpts<unknown, unknown>
            )
        }
    }

    public async addOutboundInviteHandler<InboundPayload, OutboundPayload>(
        outboundInviteHandlerOpts: OutboundInviteHandlerOpts<
            InboundPayload,
            OutboundPayload
        >
    ): Promise<void> {
        const discoveryKeyHex = b4a.toString(
            outboundInviteHandlerOpts.discoveryKey,
            'hex'
        )
        const handler = this.outboundHandlers[discoveryKeyHex]

        const _outboundInviteHandlerOpts =
            outboundInviteHandlerOpts as OutboundInviteHandlerOpts<
                unknown,
                unknown
            >

        if (handler === undefined) {
            const outer = this

            const m = this.blindPairing.addMember({
                discoveryKey: outboundInviteHandlerOpts.discoveryKey,

                async onadd(_candidate: Candidate) {
                    // TODO (robust): expand holepunch blind-peering typescript bindings
                    const candidate = _candidate as unknown as any
                    const inviteId = b4a.toString(candidate.inviteId, 'hex')

                    await outer.sequentialRunner.runSequentiallyPerId(
                        inviteId,
                        () =>
                            outer.handleOutboundInviteAcceptance(
                                inviteId,
                                _candidate,
                                outboundInviteHandlerOpts
                            )
                    )
                },
            })

            this.outboundHandlers[discoveryKeyHex] = {
                member: m,
                handlers: [_outboundInviteHandlerOpts],
            }

            await (m as any).flushed()
        } else if (
            !handler.handlers.some(
                (x) => x.purpose === outboundInviteHandlerOpts.purpose
            )
        ) {
            handler.handlers.push(_outboundInviteHandlerOpts)
        }
    }

    public async removeInboundHandlers(purpose: string): Promise<void> {
        for (const [key, value] of Object.entries(this.inboundHandlers)) {
            const newQueueItems = value.queue.filter(
                (item) => item.invite.purpose !== purpose
            )
            value.queue = newQueueItems

            // TODO (test): verify that this causes the promise in handleNextIncoming to end and remove the item from the map
            // if there are no more handlers
            if (value.current.item.invite.purpose === purpose) {
                await value.current.candidate.close()
            }
        }
    }

    public async removeInboundInvite(inviteId: string): Promise<void> {
        for (const [_, value] of Object.entries(this.inboundHandlers)) {
            const newQueueItems = value.queue.filter(
                (item) => item.invite.inviteId !== inviteId
            )
            value.queue = newQueueItems

            // TODO (test): verify that this causes the promise in handleNextIncoming to end and remove the item from the map
            // if there are no more handlers
            if (value.current.item.invite.inviteId === inviteId) {
                await value.current.candidate.close()
            }
        }
    }

    public async removeOutboundInviteHandler(
        discoveryKey: Uint8Array,
        purpose: string
    ): Promise<void> {
        const discoveryKeyHex = b4a.toString(discoveryKey, 'hex')

        const handlerEntry = this.outboundHandlers[discoveryKeyHex]

        if (handlerEntry === undefined) {
            return
        } else {
            const purposeHandlerIndex = handlerEntry.handlers.findIndex(
                (handler) => handler.purpose === purpose
            )

            if (purposeHandlerIndex > -1) {
                const [removed] = handlerEntry.handlers.splice(
                    purposeHandlerIndex,
                    1
                )

                if (
                    handlerEntry.handlers.length === 0 &&
                    removed !== undefined
                ) {
                    delete this.outboundHandlers[discoveryKeyHex]
                    await handlerEntry.member.close()
                }
            }
        }
    }

    protected override async _open(): Promise<void> {
        await this.blindPairing.ready()
        this.timerTask = this.startCleanupTimerTask()
    }

    protected override async _close(): Promise<void> {
        if (this.timerTask) {
            clearInterval(this.timerTask)
        }

        const closeMembersPromises = Object.values(this.outboundHandlers).map(handler => handler.member.close())
        const closeCandidatesPromises = Object.values(this.inboundHandlers).map(handler => handler.current.candidate.close())

        this.outboundHandlers = {};
        this.inboundHandlers = {};

        await Promise.all([...closeMembersPromises, ...closeCandidatesPromises]);
    }

    private startCleanupTimerTask(): NodeJS.Timeout {
        const interval = setInterval(
            () => this.removeExpired(this.outboundHandlers),
            60000
        )

        return interval
    }

    private async removeExpired(
        outboundHandlers: Record<string, OutboundHandlerEntry>
    ) {
        const promises: Array<Promise<void>> = []

        // TODO: fix scoping issue of outboundHandlers here
        for (const [key, value] of Object.entries(outboundHandlers)) {
            const activeEntries = value.handlers.filter(
                (entry) =>
                    entry.expiresMillisSinceEpoch === null ||
                    entry.expiresMillisSinceEpoch > Date.now()
            )

            this.outboundHandlers[key] = {
                member: value.member,
                handlers: activeEntries,
            }

            if (activeEntries.length === 0) {
                delete this.outboundHandlers[key]
                const promise = value.member.close()
                promises.push(promise)
            }
        }

        await Promise.all(promises)
    }

    private async handleOutboundInviteAcceptance<
        InboundPayload,
        OutboundPayload,
    >(
        inviteId: string,
        _candidate: Candidate,
        outboundInviteHandlerOpts: OutboundInviteHandlerOpts<
            InboundPayload,
            OutboundPayload
        >
    ): Promise<void> {
        const candidate = _candidate as unknown as any
        const sessionId = b4a.toString(candidate.requestData.session, 'hex')

        const dbEntry =
            await outboundInviteHandlerOpts.database.getInvite(inviteId)

        if (dbEntry === null || dbEntry.direction !== 'outbound') {
            return
        }

        // TODO (robust): try / catch for decode failure? Is the top level handler of onAdd enough?
        const payload = candidate.open(dbEntry.publicKey)
        const decodedInbound = decode(
            outboundInviteHandlerOpts.inboundCodec,
            payload
        )

        const existingRedemption =
            await outboundInviteHandlerOpts.database.isAlreadyUsed(
                inviteId,
                sessionId
            )
        const additional = dbEntry.additionalData.data
            ? {
                  data: encode(
                      outboundInviteHandlerOpts.outboundCodec,
                      dbEntry.additionalData.data
                  ),
                  signature: dbEntry.additionalData.signature,
              }
            : undefined

        if (
            !existingRedemption &&
            dbEntry.remaining !== null &&
            dbEntry.remaining === 0
        ) {
            candidate.deny({ status: 2 })
            return
        } else if (
            !existingRedemption &&
            (!dbEntry.expiresMillisSinceEpoch ||
                dbEntry.expiresMillisSinceEpoch > Date.now())
        ) {
            candidate.confirm({
                key: dbEntry.key,
                additional: additional,
            })

            const remaining = dbEntry.remaining ? dbEntry.remaining - 1 : null
            dbEntry.remaining = remaining

            await outboundInviteHandlerOpts.database.addInviteAcceptance(
                dbEntry,
                sessionId
            )
            await outboundInviteHandlerOpts.eventEmitter.emit(
                'inviteAccepted',
                dbEntry,
                decodedInbound
            )
        } else if (existingRedemption) {
            candidate.confirm({
                key: dbEntry.key,
                additional: additional || undefined,
            })
        }
    }

    private handleNextIncoming<I, O>(
        discoveryKeyHex: string,
        inboundHandlerOpts: InboundInviteHandlerOpts<I, O>
    ) {
        const userData = encode(
            inboundHandlerOpts.inboundCodec,
            inboundHandlerOpts.invite.payload
        )

        // TODO (robust): update holepunch typescript bindings to include 'data' parameter
        const candidate = (this.blindPairing as any).addCandidate({
            invite: inboundHandlerOpts.invite.invite,
            userData: userData,
        })

        this.inboundHandlers[discoveryKeyHex] = {
            current: {
                candidate,
                item: inboundHandlerOpts as InboundInviteHandlerOpts<
                    unknown,
                    unknown
                >,
            },
            queue: this.inboundHandlers[discoveryKeyHex]?.queue || [],
        }

        // TODO (robust): update holepunch typescript bindings to include 'pairing' promise field
        candidate.pairing
            .then(async (result: any) => {
                const decodedData = decode(
                    inboundHandlerOpts.outboundCodec,
                    result.data || Buffer.from([])
                )

                inboundHandlerOpts.invite.status = 'complete'

                await inboundHandlerOpts.database.upsertInbound(
                    inboundHandlerOpts.invite
                )

                inboundHandlerOpts.eventEmitter.emit(
                    'inviteConfirmed',
                    inboundHandlerOpts.invite,
                    result.key,
                    decodedData
                )
            })
            .catch(async (_: unknown) => {
                inboundHandlerOpts.invite.status = 'failed'
                await inboundHandlerOpts.database.upsertInbound(
                    inboundHandlerOpts.invite
                )
                await inboundHandlerOpts.eventEmitter.emit(
                    'inviteRejected',
                    inboundHandlerOpts.invite
                )
            })
            .finally(async () => {
                await candidate.close()

                const handlers = this.inboundHandlers[discoveryKeyHex]
                const nextItem = handlers?.queue.pop()

                if (!nextItem) {
                    delete this.inboundHandlers[discoveryKeyHex]
                } else {
                    this.handleNextIncoming(discoveryKeyHex, nextItem)
                }
            })

        return candidate
    }
}
