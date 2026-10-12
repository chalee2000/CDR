import { personName, recordLines, type PersonProfile } from '../lib/profiles';

/**
 * A person's details as typed in by the user, with an edit button. `compact`
 * leaves out the photo and name when the surrounding panel already shows them.
 */
export function PersonCard({ number, profile, onEdit, compact }: { number: string; profile?: PersonProfile; onEdit: () => void; compact?: boolean }) {
  const name = personName(profile);
  const records = recordLines(profile);
  if (!profile) {
    return (
      <div className={`person-card is-empty${compact ? ' compact' : ''}`}>
        {!compact && <div className="person-photo placeholder" aria-hidden="true" />}
        <div style={{ minWidth: 0 }}>
          <div className="muted">ยังไม่มีข้อมูลบุคคลของเลขนี้</div>
          <button className="btn small" type="button" onClick={onEdit}>
            เพิ่มชื่อ ที่อยู่ ประวัติคดี และรูป
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className={`person-card${compact ? ' compact' : ''}`}>
      {!compact && (profile.photo ? <img className="person-photo" src={profile.photo} alt={`รูปของ ${name ?? number}`} /> : <div className="person-photo placeholder" aria-hidden="true" />)}
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {!compact && <div className="person-name-lg">{name ?? 'ไม่ระบุชื่อ'}</div>}
        {profile.nickname && name !== profile.nickname && <div className="muted">ชื่อเล่น/ฉายา: {profile.nickname}</div>}
        {profile.address && (
          <div>
            <div className="person-label">ที่อยู่</div>
            <div className="pre-line">{profile.address}</div>
          </div>
        )}
        {records.length > 0 && (
          <div>
            <div className="person-label record">
              <span className="record-mark" aria-hidden="true">
                !
              </span>
              ประวัติคดีอาญา {records.length} รายการ
            </div>
            <ul className="record-list">
              {records.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}
        {profile.notes && (
          <div>
            <div className="person-label">หมายเหตุ</div>
            <div className="pre-line">{profile.notes}</div>
          </div>
        )}
        <div>
          <button className="btn small" type="button" onClick={onEdit}>
            แก้ไขข้อมูลบุคคล
          </button>
        </div>
      </div>
    </div>
  );
}
