import { expect, test, describe } from 'vitest'
import {
    createTestDependencies as createFreshTestDependencies,
    createTestDependencies,
    createInviteManagers as createTestInviteManagers,
    getTestnetHyperswarm as getTestnetBootstrap,
} from '../../utils.js'
import { fixed32, string } from 'compact-encoding/index.js'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Corestore from 'corestore'
import type {
    InternalInboundInvite,
    InternalOutboundInvite,
} from '../../../src/invite/blind-pairing/database/model/invite-model.js'
import { randomBytes } from 'node:crypto'
import { fail } from 'node:assert'
import {
    nullCodec,
    undefinedCodec,
} from '../../../src/invite/blind-pairing/database/model/codecs.js'
import Hyperbee from 'hyperbee'
import { BTreeInviteDatabase } from '../../../src/invite/blind-pairing/database/invite-datastore.js'

describe('Invite Manager - end to end', () => {
    const testDataDir = tmpdir() + path.sep + 'blind-pairing-tests'
    const testCorestore = new Corestore(testDataDir)

    describe('Outbound invites', () => {
        test('Invites can be created and stored', async () => {
            const dhtBootstrap = await getTestnetBootstrap()
            const { inviteManager } = await createFreshTestDependencies(
                dhtBootstrap,
                testCorestore,
                'test',
                string,
                string,
                randomBytes(10).toString('hex')
            )

            const inviterCorestore = await testCorestore
                .namespace(randomBytes(10).toString('hex'))
                .get({
                    name: 'inviter_corestore',
                })

            await inviterCorestore.ready()

            const invite = await inviteManager.createInvite(
                inviterCorestore.key,
                {
                    count: 1,
                    expiresMillisSinceEpoch: null,
                    additionalData: 'testAdditionalData',
                }
            )

            const dbEntry = await inviteManager
                .inviteData()
                .getInvite(invite.inviteId)

            expect(dbEntry).toBeDefined()
        })

        test(
            'Invites being redeemed reduces remaining count',
            { timeout: 120000 },
            async () => {
                const dhtBootstrap = await getTestnetBootstrap()

                const { inviter, invitee } = await createTestInviteManagers(
                    dhtBootstrap,
                    testCorestore,
                    'test',
                    string,
                    string
                )

                const inviterCorestore = await testCorestore
                    .namespace(randomBytes(10).toString('hex'))
                    .get({
                        name: 'inviter_corestore',
                    })

                await inviterCorestore.ready()

                const invite = await inviter.inviteManager.createInvite(
                    inviterCorestore.key,
                    {
                        count: 1,
                        expiresMillisSinceEpoch: null,
                        additionalData: 'testAdditionalData',
                    }
                )
                const dbEntry = await inviter.inviteManager
                    .inviteData()
                    .getInvite(invite.inviteId)

                expect(dbEntry).toBeDefined()

                const result = new Promise<{
                    invite: InternalOutboundInvite<string>
                    payload: string
                }>((resolve, reject) => {
                    inviter.inviteManager.events.once(
                        'inviteAccepted',
                        (invite, payload) => {
                            resolve({ invite, payload })
                        }
                    )
                })

                await invitee.inviteManager.useInvite(
                    { invite: invite.invite, purpose: invite.purpose },
                    'invitee_payload'
                )

                const received = await result

                expect(received.payload).toStrictEqual('invitee_payload')

                const newInviteState = await inviter.inviteManager
                    .inviteData()
                    .getInvite(invite.inviteId)

                if (expectOutboundInvite(newInviteState)) {
                    expect(newInviteState.remaining).toStrictEqual(0)
                }
            }
        )

        test('Null additional data works as expected', async () => {
            const dhtBootstrap = await getTestnetBootstrap()

            const { inviter, invitee } = await createTestInviteManagers(
                dhtBootstrap,
                testCorestore,
                'test',
                string,
                nullCodec
            )

            const inviterCorestore = await testCorestore
                .namespace(randomBytes(10).toString('hex'))
                .get({
                    name: 'inviter_corestore',
                })

            await inviterCorestore.ready()

            const invite = await inviter.inviteManager.createInvite(
                inviterCorestore.key,
                {
                    count: 1,
                    expiresMillisSinceEpoch: null,
                    additionalData: null,
                }
            )
            const dbEntry = await inviter.inviteManager
                .inviteData()
                .getInvite(invite.inviteId)

            expect(dbEntry).toBeDefined()

            const result = new Promise<{
                invite: InternalOutboundInvite<null>
                payload: string
            }>((resolve, reject) => {
                inviter.inviteManager.events.once(
                    'inviteAccepted',
                    (invite, payload) => {
                        resolve({ invite, payload })
                    }
                )
            })

            await invitee.inviteManager.useInvite(
                { invite: invite.invite, purpose: invite.purpose },
                'invitee_payload'
            )

            const received = await result

            expect(received.payload).toStrictEqual('invitee_payload')

            const newInviteState = await inviter.inviteManager
                .inviteData()
                .getInvite(invite.inviteId)

            if (expectOutboundInvite(newInviteState)) {
                expect(newInviteState.remaining).toStrictEqual(0)
                expect(newInviteState.additionalData.data).toStrictEqual(null)
            }
        })

        test('Undefined additional data works as expected', async () => {
            const dhtBootstrap = await getTestnetBootstrap()

            const { inviter, invitee } = await createTestInviteManagers(
                dhtBootstrap,
                testCorestore,
                'test',
                string,
                undefinedCodec
            )

            const inviterCorestore = await testCorestore
                .namespace(randomBytes(10).toString('hex'))
                .get({
                    name: 'inviter_corestore',
                })

            await inviterCorestore.ready()

            const invite = await inviter.inviteManager.createInvite(
                inviterCorestore.key,
                {
                    count: 1,
                    expiresMillisSinceEpoch: null,
                    additionalData: undefined,
                }
            )
            const dbEntry = await inviter.inviteManager
                .inviteData()
                .getInvite(invite.inviteId)

            expect(dbEntry).toBeDefined()

            const result = new Promise<{
                invite: InternalOutboundInvite<undefined>
                payload: string
            }>((resolve, reject) => {
                inviter.inviteManager.events.once(
                    'inviteAccepted',
                    (invite, payload) => {
                        resolve({ invite, payload })
                    }
                )
            })

            await invitee.inviteManager.useInvite(
                { invite: invite.invite, purpose: invite.purpose },
                'invitee_payload'
            )

            const received = await result

            expect(received.payload).toStrictEqual('invitee_payload')

            const newInviteState = await inviter.inviteManager
                .inviteData()
                .getInvite(invite.inviteId)

            if (expectOutboundInvite(newInviteState)) {
                expect(newInviteState.remaining).toStrictEqual(0)
                expect(newInviteState.additionalData.data).toStrictEqual(
                    undefined
                )
            }
        })

        test('Additional nodes added to invite', () => {})

        test('Outbound invite re-loaded from storage on startup can be redeemed as expected', async () => {
            const dhtBootstrap = await getTestnetBootstrap()

            const databaseCorestoreName = randomBytes(10).toString('hex')

            const {
                inviteManager,
                hyperbee,
                sharedBlindPairing: mbp,
                blindPairing,
            } = await createTestDependencies(
                dhtBootstrap,
                testCorestore,
                'test',
                string,
                nullCodec,
                databaseCorestoreName
            )

            const inviteeDependencies = await createTestDependencies(
                dhtBootstrap,
                testCorestore,
                'test',
                string,
                nullCodec,
                randomBytes(10).toString('hex')
            )

            const inviterKey = Buffer.alloc(32).fill('testaroonie')

            const outboundInvite = await inviteManager.createInvite(
                inviterKey,
                {
                    count: 1,
                    additionalData: null,
                    expiresMillisSinceEpoch: null,
                }
            )

            await inviteManager.close()
            await hyperbee.close()
            await mbp.close()
            await blindPairing.close()

            // Reload the test dependencies then redeem the invite
            const reloadedTestDependencies = await createTestDependencies(
                dhtBootstrap,
                testCorestore,
                'test',
                string,
                nullCodec,
                databaseCorestoreName
            )

            const inviteAcceptedEmitted = new Promise<{
                invite: InternalOutboundInvite<null>
                payload: string
            }>((resolve, reject) => {
                reloadedTestDependencies.inviteManager.events.once(
                    'inviteAccepted',
                    (invite, payload) => {
                        resolve({ invite, payload })
                    }
                )
            })

            await inviteeDependencies.inviteManager.useInvite(
                {
                    invite: outboundInvite.invite,
                    purpose: outboundInvite.purpose,
                },
                'invitee_payload'
            )

            await reloadedTestDependencies.inviteManager.ready()

            const event = await inviteAcceptedEmitted

            expect(event.invite.inviteId).toStrictEqual(outboundInvite.inviteId)
            expect(event.payload).toStrictEqual('invitee_payload')
        })

        test('Outbound invite is rejected if all invites have been used', () => {})

        test('Outbound invite is rejected if it has expired', () => {})

        test('Multiple outbound invites can be active', () => {})

        test('When all outbound invites have expired, incoming invite handlers are removed', () => {})

        test('Outbound invite can use object with compact-encoding serialiser for additional data', () => {})

        test('Outbound invite is accepted if it has already been redeemed (without decrementing usages)', () => {})
    })

    describe('Inbound invites', () => {
        test('Invite can be redeemed', async () => {
            const dhtBootstrap = await getTestnetBootstrap()

            const { inviter, invitee } = await createTestInviteManagers<
                Uint8Array,
                string
            >(dhtBootstrap, testCorestore, 'test', fixed32, string)

            const inviterCorestore = await testCorestore
                .namespace(randomBytes(10).toString('hex'))
                .get({
                    name: 'inviter_corestore',
                })

            await inviterCorestore.ready()

            const inviteeCorestore = await testCorestore
                .namespace(randomBytes(10).toString('hex'))
                .get({
                    name: 'invitee_corestore',
                })

            await inviteeCorestore.ready()

            const invite = await inviter.inviteManager.createInvite(
                inviterCorestore.key,
                {
                    count: 1,
                    expiresMillisSinceEpoch: null,
                    additionalData: 'testaroonie',
                }
            )

            const dbEntry = await inviter.inviteManager
                .inviteData()
                .getInvite(invite.inviteId)

            expect(dbEntry).toBeDefined()

            const inboundResult = new Promise<{
                invite: InternalInboundInvite<Uint8Array>
                key: Uint8Array
                payload: string
            }>((resolve, reject) => {
                invitee.inviteManager.events.once(
                    'inviteConfirmed',
                    (invite, key, payload) => {
                        resolve({ invite, key, payload })
                    }
                )
            })

            const outboundResult = new Promise<{
                invite: InternalOutboundInvite<string>
                payload: Uint8Array
            }>((resolve, reject) => {
                inviter.inviteManager.events.once(
                    'inviteAccepted',
                    (invite, payload) => {
                        resolve({ invite, payload })
                    }
                )
            })

            await invitee.inviteManager.useInvite(
                { invite: invite.invite, purpose: invite.purpose },
                inviteeCorestore.key
            )

            const inboundReceived = await inboundResult

            expect(inboundReceived.key).toStrictEqual(inviterCorestore.key)
            expect(inboundReceived.payload).toStrictEqual('testaroonie')

            const newInviteState = await invitee.inviteManager
                .inviteData()
                .getInvite(invite.inviteId)

            if (expectInboundInvite(newInviteState)) {
                expect(newInviteState.status).toStrictEqual('complete')
            }

            const outboundReceived = await outboundResult

            expect(outboundReceived.payload).toStrictEqual(inviteeCorestore.key)
        })

        test('Inbound invite reloaded from storage on startup can be redeemed', {timeout: 120000}, async () => {
            const dhtBootstrap = await getTestnetBootstrap()

            const inviteeDatabaseCorestoreName = randomBytes(10).toString('hex')

            const {
                inviteManager,
                hyperbee,
                sharedBlindPairing: mbp,
                blindPairing,
            } = await createTestDependencies<string, null>(
                dhtBootstrap,
                testCorestore,
                'test',
                string,
                nullCodec,
                randomBytes(10).toString('hex')
            )

            await inviteManager.ready()

            const inviterKey = Buffer.alloc(32).fill('testaroonie')

            const outboundInvite = await inviteManager.createInvite(
                inviterKey,
                {
                    count: 1,
                    additionalData: null,
                    expiresMillisSinceEpoch: null,
                }
            )

            const inviteeDbCore = await testCorestore.get({
                name: inviteeDatabaseCorestoreName,
            })
            await inviteeDbCore
            const inviteeDbBee = new Hyperbee(inviteeDbCore as any)
            await inviteeDbBee

            const inviteeInviteDb = new BTreeInviteDatabase<string, null>(
                inviteeDbBee,
                outboundInvite.purpose,
                string,
                nullCodec
            )

            // Insert the invite in the database ahead of loading the invite manager
            await inviteeInviteDb.upsertInbound({
                invite: outboundInvite.invite,
                createdAtMillisSinceEpoch: Date.now(),
                direction: 'inbound',
                expiresMillisSinceEpoch: outboundInvite.expiresMillisSinceEpoch,
                inviteId: outboundInvite.inviteId,
                payload: 'invitee_test',
                purpose: outboundInvite.purpose,
                status: 'pending',
            })

            await inviteeDbBee.close()
            await inviteeDbCore.close()

            const inviteeDependencies = await createTestDependencies(
                dhtBootstrap,
                testCorestore,
                'test',
                string,
                nullCodec,
                inviteeDatabaseCorestoreName
            )

            const result = new Promise<{
                invite: InternalInboundInvite<string>,
                key: Uint8Array,
                payload: null
            }>((resolve, reject) => {
                inviteeDependencies.inviteManager.events.once(
                    'inviteConfirmed',
                    (invite, key, payload) => {
                        resolve({invite, key, payload})
                    }
                )
            })

            await inviteeDependencies.inviteManager.ready();

            const inviteConfirmationDetails = await result

            expect(inviteConfirmationDetails.invite.inviteId).toStrictEqual(outboundInvite.inviteId)
        })

        test('Invite rejection triggers event', () => {})

        test('Multiple invites with the same discovery key results in the invite being queued', () => {})

        test("When a invite is completed it is not added to the 'shared blind pairing' instance at startup", () => {})
    })

    describe('Lifecycle management', () => {
        test('Deleting an outbound invite results in the blind pairing member being closed', () => {})

        test('Deleting an inbound invite results in the blind pairing candidate being closed', () => {})

        test('Expired inbound invites are not added to blind pairing at invite manager load', () => {})

        test('Expired outbound invites are not added to blind pairing at invite manager load', () => {})
    })

    function expectOutboundInvite<I, O>(
        invite: InternalInboundInvite<I> | InternalOutboundInvite<O> | null
    ): invite is InternalOutboundInvite<O> {
        if (invite === null) {
            fail('Invite is unexpectedly null')
        } else if (invite.direction === 'outbound') {
            return true
        } else {
            fail('Not outbound invite as expected')
        }
    }

    function expectInboundInvite<I, O>(
        invite: InternalInboundInvite<I> | InternalOutboundInvite<O> | null
    ): invite is InternalInboundInvite<I> {
        if (invite === null) {
            fail('Invite is unexpectedly null')
        } else if (invite.direction === 'inbound') {
            return true
        } else {
            fail('Not outbound invite as expected')
        }
    }
})
