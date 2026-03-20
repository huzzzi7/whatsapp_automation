export default function Card({ children, className = '', style, ...rest }) {
  return (
    <div className={`ui-card ${className}`.trim()} style={style} {...rest}>
      {children}
    </div>
  );
}
