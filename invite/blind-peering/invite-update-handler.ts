

export interface InviteUpdateHandler<T> {

    /**
     * Called when an invitee has accepted our invite.
     */
    onInviteAccepted(inviteId: string, payload: T): Promise<void>;

    /**
     * Called when the inviter has confirmed that they have accepted our use of the invite.
     */
    onInviteConfirmed(inviteId: string, payload: T): Promise<void>;

    /**
     * Called when the invite has rejected our use of the invite (due to it already being used by another person, for example)
     */
    onInviteRejected(inviteId: string): Promise<void>;
}