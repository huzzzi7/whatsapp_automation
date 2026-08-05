import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Button from '../components/ui/Button';
import {
  listCampaignsApi,
  listConversations,
  getConversationMessages,
  markConversationSeen,
  sendConversationMessage,
  getMediaUrl,
} from '../api';

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'sent', label: 'Sent' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'read', label: 'Read' },
  { value: 'failed', label: 'Failed' },
];

function formatDt(value) {
  if (value == null) return '';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString();
  } catch {
    return '';
  }
}

function MessageBubble({ msg }) {
  const isOutbound = msg.direction === 'outbound';
  const senderLabel = msg.sender === 'admin' ? 'You' : msg.sender === 'system' ? 'System' : null;

  let body = null;
  if (msg.messageType === 'reaction') {
    body = <em>Reacted {msg.reactionEmoji || ''}</em>;
  } else if (['image', 'video', 'document', 'audio', 'sticker'].includes(msg.messageType) && msg.mediaPath) {
    const url = getMediaUrl(msg.mediaPath, msg.mediaMimeType);
    if (msg.messageType === 'image' || msg.messageType === 'sticker') {
      body = (
        <>
          <img src={url} alt={msg.mediaCaption || 'image'} style={{ maxWidth: 220, borderRadius: 8, display: 'block' }} />
          {msg.mediaCaption ? <div style={{ marginTop: 4 }}>{msg.mediaCaption}</div> : null}
        </>
      );
    } else if (msg.messageType === 'video') {
      body = <video src={url} controls style={{ maxWidth: 240, borderRadius: 8, display: 'block' }} />;
    } else {
      body = (
        <a href={url} target="_blank" rel="noreferrer">
          📎 {msg.mediaFilename || msg.messageType}
        </a>
      );
    }
  } else if (msg.messageType === 'button') {
    body = <span>↩ {msg.buttonTitle || msg.buttonId}</span>;
  } else {
    body = msg.bodyText || <span style={{ opacity: 0.6 }}>—</span>;
  }

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isOutbound ? 'flex-end' : 'flex-start',
        marginBottom: '0.5rem',
      }}
    >
      <div
        style={{
          maxWidth: '70%',
          padding: '0.5rem 0.75rem',
          borderRadius: 12,
          background: isOutbound ? 'var(--primary)' : 'var(--surface)',
          color: isOutbound ? '#fff' : 'var(--text-primary)',
          border: isOutbound ? 'none' : '1px solid var(--border)',
          fontSize: '0.875rem',
        }}
      >
        {senderLabel ? (
          <div style={{ fontSize: '0.7rem', opacity: 0.75, marginBottom: 2 }}>{senderLabel}</div>
        ) : null}
        {body}
        <div style={{ fontSize: '0.7rem', opacity: 0.7, marginTop: 4, textAlign: 'right' }}>
          {formatDt(msg.createdAt)}
        </div>
      </div>
    </div>
  );
}

export default function ChatsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialCampaignId = searchParams.get('campaignId') || '';

  const [campaigns, setCampaigns] = useState([]);
  const [campaignId, setCampaignId] = useState(initialCampaignId);
  const [deliveryStatus, setDeliveryStatus] = useState('');
  const [unseenOnly, setUnseenOnly] = useState(false);

  const [conversations, setConversations] = useState([]);
  const [convLoading, setConvLoading] = useState(true);
  const [convError, setConvError] = useState('');

  const [selectedPhone, setSelectedPhone] = useState(null);
  const [messages, setMessages] = useState([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState('');

  const [replyText, setReplyText] = useState('');
  const [replyFile, setReplyFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  const fileInputRef = useRef(null);
  const threadEndRef = useRef(null);

  useEffect(() => {
    listCampaignsApi()
      .then((data) => setCampaigns(Array.isArray(data?.campaigns) ? data.campaigns : []))
      .catch(() => setCampaigns([]));
  }, []);

  const loadConversations = useCallback(async () => {
    setConvLoading(true);
    setConvError('');
    try {
      const data = await listConversations({
        campaignId,
        deliveryStatus,
        unseen: unseenOnly,
        page: 1,
        limit: 100,
      });
      setConversations(Array.isArray(data?.conversations) ? data.conversations : []);
    } catch (e) {
      setConvError(e.message || 'Failed to load conversations');
    } finally {
      setConvLoading(false);
    }
  }, [campaignId, deliveryStatus, unseenOnly]);

  useEffect(() => {
    loadConversations();
    const interval = setInterval(loadConversations, 15000);
    return () => clearInterval(interval);
  }, [loadConversations]);

  useEffect(() => {
    if (campaignId) {
      setSearchParams(campaignId ? { campaignId } : {}, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  const loadThread = useCallback(async (phone) => {
    setThreadLoading(true);
    setThreadError('');
    try {
      const data = await getConversationMessages(phone, { limit: 200 });
      setMessages(Array.isArray(data?.messages) ? data.messages : []);
      await markConversationSeen(phone);
      setConversations((prev) => prev.map((c) => (c.phoneNormalized === phone ? { ...c, isUnseen: false } : c)));
    } catch (e) {
      setThreadError(e.message || 'Failed to load conversation');
    } finally {
      setThreadLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedPhone) loadThread(selectedPhone);
  }, [selectedPhone, loadThread]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const handleSelectConversation = (phone) => {
    setSelectedPhone(phone);
    setReplyText('');
    setReplyFile(null);
  };

  const handleSend = async () => {
    if (!selectedPhone || (!replyText.trim() && !replyFile)) return;
    setSending(true);
    setSendError('');
    try {
      await sendConversationMessage(selectedPhone, { text: replyText.trim(), file: replyFile });
      setReplyText('');
      setReplyFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await loadThread(selectedPhone);
      await loadConversations();
    } catch (e) {
      setSendError(e.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const selectedConversation = conversations.find((c) => c.phoneNormalized === selectedPhone);

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 100px)', gap: '1rem' }}>
      <div
        style={{
          width: 340,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          overflow: 'hidden',
          background: 'var(--surface)',
        }}
      >
        <div style={{ padding: '0.75rem', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <select
            className="ui-input-field"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
          >
            <option value="">All campaigns</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName || c.name || c.id}
              </option>
            ))}
          </select>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value || 'all'}
                type="button"
                className={
                  deliveryStatus === f.value
                    ? 'campaign-users-modal__filter campaign-users-modal__filter--active'
                    : 'campaign-users-modal__filter'
                }
                onClick={() => setDeliveryStatus(f.value)}
              >
                {f.label}
              </button>
            ))}
            <button
              type="button"
              className={
                unseenOnly
                  ? 'campaign-users-modal__filter campaign-users-modal__filter--active'
                  : 'campaign-users-modal__filter'
              }
              onClick={() => setUnseenOnly((v) => !v)}
            >
              Unseen
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {convLoading ? <p style={{ padding: '0.75rem', color: 'var(--text-muted)' }}>Loading…</p> : null}
          {convError ? <div className="alert-error" style={{ margin: '0.75rem' }}>{convError}</div> : null}
          {!convLoading && !convError && conversations.length === 0 ? (
            <p style={{ padding: '0.75rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>No conversations yet.</p>
          ) : null}
          {conversations.map((c) => (
            <button
              key={c.phoneNormalized}
              type="button"
              onClick={() => handleSelectConversation(c.phoneNormalized)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '0.65rem 0.75rem',
                border: 'none',
                borderBottom: '1px solid var(--border)',
                background: selectedPhone === c.phoneNormalized ? 'var(--bg)' : 'transparent',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <strong style={{ fontSize: '0.875rem' }}>
                  {c.displayName || c.phoneNormalized}
                  {c.isUnseen ? <span style={{ color: 'var(--danger, #e11d48)', marginLeft: 6 }}>●</span> : null}
                </strong>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{formatDt(c.lastMessageAt)}</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{c.phoneNormalized}</div>
              {c.campaignName ? (
                <div style={{ fontSize: '0.7rem', color: 'var(--primary)', marginTop: 2 }}>{c.campaignName}</div>
              ) : null}
              <div
                style={{
                  fontSize: '0.8rem',
                  marginTop: 2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {c.lastMessagePreview || '—'}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          overflow: 'hidden',
          background: 'var(--surface)',
        }}
      >
        {!selectedPhone ? (
          <div style={{ margin: 'auto', color: 'var(--text-muted)' }}>Select a conversation</div>
        ) : (
          <>
            <div style={{ padding: '0.75rem', borderBottom: '1px solid var(--border)' }}>
              <strong>{selectedConversation?.displayName || selectedPhone}</strong>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {selectedPhone}
                {selectedConversation?.campaignName ? ` · ${selectedConversation.campaignName}` : ''}
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem' }}>
              {threadLoading ? <p style={{ color: 'var(--text-muted)' }}>Loading…</p> : null}
              {threadError ? <div className="alert-error">{threadError}</div> : null}
              {messages.map((m) => (
                <MessageBubble key={m.id} msg={m} />
              ))}
              <div ref={threadEndRef} />
            </div>
            <div style={{ padding: '0.75rem', borderTop: '1px solid var(--border)' }}>
              {sendError ? <div className="alert-error" style={{ marginBottom: '0.5rem' }}>{sendError}</div> : null}
              {replyFile ? (
                <div style={{ fontSize: '0.8rem', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                  📎 {replyFile.name}
                  <button
                    type="button"
                    onClick={() => {
                      setReplyFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    style={{ background: 'none', border: 'none', color: 'var(--danger, #e11d48)', cursor: 'pointer' }}
                  >
                    ✕
                  </button>
                </div>
              ) : null}
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  style={{ display: 'none' }}
                  onChange={(e) => setReplyFile(e.target.files?.[0] || null)}
                />
                <Button
                  type="button"
                  className="ui-button--inline ui-button--secondary"
                  onClick={() => fileInputRef.current?.click()}
                >
                  📎
                </Button>
                <input
                  className="ui-input-field"
                  style={{ flex: 1 }}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Type a message… (emoji work like normal text)"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                />
                <Button type="button" className="ui-button--inline" onClick={handleSend} disabled={sending}>
                  {sending ? 'Sending…' : 'Send'}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
