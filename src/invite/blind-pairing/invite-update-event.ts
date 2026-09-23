import type {
    InternalInboundInvite,
    InternalOutboundInvite,
} from './database/model/invite-model.js'

export type InviteUpdateEvent<InboundPayload, OutboundPayload> = {
    /**
     * Emitted when an invitee has accepted our invite.
     */
    inviteAccepted: (
        invite: InternalOutboundInvite<OutboundPayload>,
        payload: InboundPayload
    ) => void | Promise<void>

    /**
     * Emitted when the inviter has confirmed that they have accepted our use of the invite.
     */
    inviteConfirmed: (
        invite: InternalInboundInvite<InboundPayload>,
        key: Uint8Array,
        payload: OutboundPayload
    ) => void | Promise<void>

    /**
     * Emitted when the invite has rejected our use of the invite (due to it already being used by another person, for example)
     */
    inviteRejected: (
        invite: InternalInboundInvite<InboundPayload>
    ) => void | Promise<void>
}
