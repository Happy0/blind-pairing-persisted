import type { InternalInboundInvite, InternalOutboundInvite } from "./database/model/invite-model.js";


export interface InviteUpdateHandler<InboundPayload, OutboundPayload> {

    /**
     * Called when an invitee has accepted our invite.
     */
    onInviteAccepted(invite: InternalOutboundInvite<OutboundPayload>, payload: InboundPayload): Promise<void>;

    /**
     * Called when the inviter has confirmed that they have accepted our use of the invite.
     */
    onInviteConfirmed(invite: InternalInboundInvite<InboundPayload>, payload: OutboundPayload): Promise<void>;

    /**
     * Called when the invite has rejected our use of the invite (due to it already being used by another person, for example)
     */
    onInviteRejected(invite: InternalInboundInvite<InboundPayload>): Promise<void>;
}