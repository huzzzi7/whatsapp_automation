function truncate(str, maxLen, ellipsis = '...') {
  const s = str == null ? '' : String(str);
  if (s.length <= maxLen) return s;
  const cut = maxLen - ellipsis.length;
  return cut > 0 ? s.slice(0, cut) + ellipsis : ellipsis;
}

/** Presentational table for one university's users (parity: message 50, link 40 chars like legacy app.js). */
export default function CampaignUsersTable({ users }) {
  if (!users?.length) return null;

  return (
    <table className="automation-table automation-table--compact">
      <thead>
        <tr>
          <th>Phone</th>
          <th>City</th>
          <th>Link</th>
          <th>Message 1</th>
        </tr>
      </thead>
      <tbody>
        {users.map((u, i) => {
          const msg1 = u.sequence?.[0] ?? '';
          const link = u.link ?? '';
          return (
            <tr key={`${u.phone}-${i}`}>
              <td>{u.phone}</td>
              <td>{u.city ?? ''}</td>
              <td title={link}>{truncate(link, 40)}</td>
              <td title={msg1}>{truncate(msg1, 50)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
