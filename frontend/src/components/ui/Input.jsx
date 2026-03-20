import { useId } from 'react';

export default function Input({ label, id, className = '', ...props }) {
  const genId = useId();
  const inputId = id || genId;

  return (
    <div className={`ui-input-wrap ${className}`.trim()}>
      <label htmlFor={inputId} className="ui-input-label">
        {label}
      </label>
      <input id={inputId} className="ui-input-field" {...props} />
    </div>
  );
}
