import { Schema, model } from 'mongoose';
import { CHAT_ITEM_TYPES } from '@campuscare/shared';

/**
 * Per-user organisation of the Chats center (pin, mute, archive, mark unread, last opened).
 * It never grants access: every item is re-authorised by the API that owns it.
 */
const chatPreferenceSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    itemType: { type: String, enum: CHAT_ITEM_TYPES, required: true },
    itemId: { type: Schema.Types.ObjectId, required: true },
    pinned: { type: Boolean, default: false },
    archived: { type: Boolean, default: false },
    muted: { type: Boolean, default: false },
    markedUnread: { type: Boolean, default: false },
    /** Read marker for items without their own read state (support tickets). */
    lastReadAt: { type: Date, default: null },
  },
  { timestamps: true },
);
chatPreferenceSchema.index({ userId: 1, itemType: 1, itemId: 1 }, { unique: true });
chatPreferenceSchema.index({ itemType: 1, itemId: 1, muted: 1 });
export const ChatPreference = model('ChatPreference', chatPreferenceSchema);
