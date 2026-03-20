export default function Button({
  children,
  loading,
  className = '',
  type = 'button',
  disabled,
  ...props
}) {
  return (
    <button
      type={type}
      disabled={loading || disabled}
      className={`ui-button ${className}`.trim()}
      {...props}
    >
      {loading ? 'Loading…' : children}
    </button>
  );
}
