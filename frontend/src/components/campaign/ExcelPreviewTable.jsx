const PREVIEW_LIMIT = 100;

/**
 * Scrollable preview of uploaded campaign users (max rows for performance).
 * @param {{ users?: Array<Record<string, unknown>> }} props
 */
export default function ExcelPreviewTable({ users = [] }) {
  const list = Array.isArray(users) ? users : [];
  const previewUsers = list.slice(0, PREVIEW_LIMIT);
  const hasMore = list.length > PREVIEW_LIMIT;

  const cell = (u, key) => {
    const v = u?.[key];
    if (v == null) return '';
    return String(v);
  };

  return (
    <div>
      <div
        style={{
          maxHeight: '300px',
          overflowY: 'auto',
          border: '1px solid #eee',
          borderRadius: '8px',
          padding: '8px',
        }}
      >
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '13px',
          }}
        >
          <thead>
            <tr>
              <th
                style={{
                  position: 'sticky',
                  top: 0,
                  background: 'var(--surface, #fff)',
                  textAlign: 'left',
                  padding: '8px 6px',
                  borderBottom: '1px solid #eee',
                  zIndex: 1,
                }}
              >
                #
              </th>
              <th
                style={{
                  position: 'sticky',
                  top: 0,
                  background: 'var(--surface, #fff)',
                  textAlign: 'left',
                  padding: '8px 6px',
                  borderBottom: '1px solid #eee',
                  zIndex: 1,
                }}
              >
                Phone
              </th>
              <th
                style={{
                  position: 'sticky',
                  top: 0,
                  background: 'var(--surface, #fff)',
                  textAlign: 'left',
                  padding: '8px 6px',
                  borderBottom: '1px solid #eee',
                  zIndex: 1,
                }}
              >
                University
              </th>
              <th
                style={{
                  position: 'sticky',
                  top: 0,
                  background: 'var(--surface, #fff)',
                  textAlign: 'left',
                  padding: '8px 6px',
                  borderBottom: '1px solid #eee',
                  zIndex: 1,
                }}
              >
                Group
              </th>
              <th
                style={{
                  position: 'sticky',
                  top: 0,
                  background: 'var(--surface, #fff)',
                  textAlign: 'left',
                  padding: '8px 6px',
                  borderBottom: '1px solid #eee',
                  zIndex: 1,
                }}
              >
                City
              </th>
              <th
                style={{
                  position: 'sticky',
                  top: 0,
                  background: 'var(--surface, #fff)',
                  textAlign: 'left',
                  padding: '8px 6px',
                  borderBottom: '1px solid #eee',
                  zIndex: 1,
                }}
              >
                Link
              </th>
            </tr>
          </thead>
          <tbody>
            {previewUsers.map((u, i) => (
              <tr key={i}>
                <td style={{ padding: '6px', borderBottom: '1px solid #f5f5f5' }}>{i + 1}</td>
                <td style={{ padding: '6px', borderBottom: '1px solid #f5f5f5' }}>{cell(u, 'phone')}</td>
                <td style={{ padding: '6px', borderBottom: '1px solid #f5f5f5' }}>{cell(u, 'university')}</td>
                <td
                  style={{
                    padding: '6px',
                    borderBottom: '1px solid #f5f5f5',
                    maxWidth: '160px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={cell(u, 'group')}
                >
                  {cell(u, 'group')}
                </td>
                <td style={{ padding: '6px', borderBottom: '1px solid #f5f5f5' }}>{cell(u, 'city')}</td>
                <td
                  style={{
                    padding: '6px',
                    borderBottom: '1px solid #f5f5f5',
                    maxWidth: '160px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={cell(u, 'link')}
                >
                  {cell(u, 'link')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore ? (
        <p style={{ margin: '8px 0 0', fontSize: '12px', color: 'var(--text-muted, #666)' }}>
          Showing first {PREVIEW_LIMIT} of {list.length} users
        </p>
      ) : null}
    </div>
  );
}
