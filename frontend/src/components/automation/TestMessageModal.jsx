import { useRef, useEffect, useState } from 'react';
import CampaignTestForm from '../campaign/CampaignTestForm';

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {{ id: string; name?: string }[]} props.instances
 * @param {string} props.defaultInstanceId
 * @param {string[]} props.messageTemplateStrings
 * @param {(msg: string, type?: 'success'|'error') => void} [props.onResult] – optional parent status line
 */
export default function TestMessageModal({
  open,
  onClose,
  instances,
  defaultInstanceId,
  messageTemplateStrings,
  onResult,
}) {
  const dialogRef = useRef(null);
  const modalRef = useRef(null);
  const firstFieldRef = useRef(null);
  const [formValue, setFormValue] = useState({
    phone: '',
    university: '',
    link: '',
    group: '',
    greenInstanceId: '',
  });

  useEffect(() => {
    if (open) {
      setFormValue({
        phone: '',
        university: '',
        link: '',
        group: '',
        greenInstanceId: defaultInstanceId || '',
      });
    }
  }, [open, defaultInstanceId]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
    }
    if (!open && el.open) {
      el.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const id = requestAnimationFrame(() => {
      firstFieldRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const handleClose = () => onClose();
    const handleDialogClick = (e) => {
      if (e.target === el) onClose();
    };
    el.addEventListener('close', handleClose);
    el.addEventListener('click', handleDialogClick);
    return () => {
      el.removeEventListener('close', handleClose);
      el.removeEventListener('click', handleDialogClick);
    };
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const handleClickOutside = (e) => {
      if (modalRef.current && !modalRef.current.contains(e.target)) {
        onClose();
      }
    };
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open, onClose]);

  return (
    <dialog
      ref={dialogRef}
      className="test-message-modal"
      aria-labelledby="test-message-modal-title"
      aria-describedby="test-message-modal-desc"
    >
      <div ref={modalRef}>
        <h2 id="test-message-modal-title" className="test-message-modal__title">
          Test reply automation
        </h2>
        <p id="test-message-modal-desc" className="test-message-modal__note">
        </p>

        <CampaignTestForm
          value={formValue}
          onChange={setFormValue}
          instances={instances}
          messageTemplateStrings={messageTemplateStrings}
          onResult={(msg, type) => {
            onResult?.(msg, type);
            if (type === 'success') onClose();
          }}
          onCancel={() => onClose()}
          phoneInputRef={firstFieldRef}
        />
      </div>
    </dialog>
  );
}
