import { useRef, useState } from 'react';
import { uploadFile } from '../../api';
import Button from '../ui/Button';

export default function ExcelUploadSection({
  onUploaded,
  onError,
  disabled,
  onAdjustCampaignMessages,
  /** When false, hides the "Campaign Settings" toolbar button (e.g. wizard Step 1). Default true. */
  showCampaignSettingsButton = true,
  /** 'meta' — determines which Excel parsing path the backend uses. */
  provider = 'meta',
}) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const busy = disabled || uploading;

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
