import { useRef, useState } from 'react';
import { uploadFile } from '../../api';
import Button from '../ui/Button';

/**
 * @param {object} props
 * @param {{ id: string, name: string }[]} props.instances
 * @param {string} props.selectedInstanceId
 * @param {(id: string) => void} props.onSelectInstance
 */
export default function ExcelUploadSection({
  onUploaded,
  onError,
  disabled,
  onAdjustCampaignMessages,
  /** When false, hides the "Campaign Settings" toolbar button (e.g. wizard Step 1). Default true. */
  showCampaignSettingsButton = true,
  instances,
  selectedInstanceId,
  onSelectInstance,
  /** 'green' | 'meta' — determines which Excel parsing path the backend uses. Default 'green'. */
  provider = 'green',
}) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const busy = disabled || uploading;
  const hasInstances = instances?.length > 0;
  const canAct = true;

  const publicWebhookBase = (import.meta.env.VITE_PUBLIC_WEBHOOK_BASE_URL || import.meta.env.VITE_API_URL || '')
    .trim()
    .replace(/\/$/, '');
  const selectedInst = instances?.find((i) => i.id === selectedInstanceId);
  const webhookPath = selectedInst?.webhookPath || (selectedInstanceId ? `/api/webhook/greenapi/${selectedInstanceId}` : '');
  const fullWebhookUrl =
    publicWebhookBase && webhookPath ? `${publicWebhookBase}${webhookPath}` : '';

  const handleUpload = async () => {
    const file = inputRef.current?.files?.[0];
    if (!file) {
      onError?.('Please select a file.');
      return;
    }
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      onError?.('Only .xlsx files are allowed.');
      return;
    }

    setUploading(true);
    onError?.('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('provider', provider);
      if (provider !== 'meta' && selectedInstanceId) {
        formData.append('greenInstanceId', selectedInstanceId);
      }
      const data = await uploadFile(formData);
      onUploaded?.(data);
    } catch (e) {
      onError?.(e.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="automation-section excel-upload-section">
      <h2>Upload Excel</h2>
      <p className="excel-upload-section__hint">
        Select an .xlsx file with campaign columns (same format as the legacy uploader).
      </p>

      {onSelectInstance ? (
        <div className="instance-select-row">
          <label htmlFor="green-inst-select" className="ui-input-label">
            Send from instance
          </label>
          <select
            id="green-inst-select"
            className="ui-input-field instance-select"
            value={selectedInstanceId}
            onChange={(e) => onSelectInstance?.(e.target.value)}
            disabled={busy}
          >
            {!hasInstances ? (
              <option value="">No instances — add in Settings</option>
            ) : (
              <>
                <option value="">Select instance…</option>
                {instances.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </>
            )}
          </select>
        </div>
      ) : null}

      {selectedInstanceId && webhookPath ? (
        <p className="excel-upload-section__webhook-hint" role="note">
          
        </p>
      ) : null}

      <div className="automation-upload-toolbar">
        <div className="automation-upload-toolbar__file">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="automation-file-input"
            disabled={busy}
          />
        </div>
        <div className="automation-upload-toolbar__actions">
          {showCampaignSettingsButton ? (
            <Button
              type="button"
              className="ui-button--inline ui-button--secondary adjust-messages-btn"
              onClick={() => onAdjustCampaignMessages?.()}
              disabled={busy}
            >
              Campaign Settings
            </Button>
          ) : null}
          <Button
            type="button"
            className="upload-btn ui-button--inline"
            onClick={handleUpload}
            disabled={busy}
            loading={uploading}
          >
            Upload
          </Button>
        </div>
      </div>
    </section>
  );
}
