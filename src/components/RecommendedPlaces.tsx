import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { recommendationPhotoBucket, supabase, supabaseConfigured } from '../services/supabase';

interface RecommendedPlace {
  id: string;
  name: string;
  address: string;
  price_range: string;
  real_review: string;
  signature_dishes: string;
  hygiene: string;
  ambience: string;
  suitable_hours: string;
  photos: string[];
  created_at: string;
}

interface PlaceDraft extends Omit<RecommendedPlace, 'created_at'> {
  pendingPhotos: File[];
}

const emptyDraft = (): PlaceDraft => ({
  id: '',
  name: '',
  address: '',
  price_range: '',
  real_review: '',
  signature_dishes: '',
  hygiene: '',
  ambience: '',
  suitable_hours: '',
  photos: [],
  pendingPhotos: [],
});

function publicPhotoUrl(path: string): string {
  return supabase?.storage.from(recommendationPhotoBucket).getPublicUrl(path).data.publicUrl || '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Đã xảy ra lỗi. Vui lòng thử lại.';
}

export function RecommendedPlaces() {
  const [places, setPlaces] = useState<RecommendedPlace[]>([]);
  const [selected, setSelected] = useState<RecommendedPlace | null>(null);
  const [editing, setEditing] = useState<RecommendedPlace | null>(null);
  const [draft, setDraft] = useState<PlaceDraft>(emptyDraft);
  const [isAdmin, setIsAdmin] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pendingPreviews, setPendingPreviews] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState('');
  const detailDialog = useRef<HTMLDialogElement>(null);
  const loginDialog = useRef<HTMLDialogElement>(null);
  const editorDialog = useRef<HTMLDialogElement>(null);

  async function loadPlaces() {
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('recommended_places')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) setMessage(`Không tải được danh sách: ${error.message}`);
    else {
      setPlaces((data || []) as RecommendedPlace[]);
      setMessage('');
    }
    setLoading(false);
  }

  async function updateAdminStatus(currentSession: Session | null) {
    setSignedIn(Boolean(currentSession));
    if (!supabase || !currentSession) {
      setIsAdmin(false);
      return;
    }
    const { data, error } = await supabase.rpc('is_recommendation_admin');
    setIsAdmin(!error && data === true);
    if (error) setMessage(`Không kiểm tra được quyền quản trị: ${error.message}`);
    else if (data !== true) setMessage('Tài khoản này chưa được cấp quyền chỉnh sửa danh sách.');
    else setMessage('');
  }

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setMessage(`Không khôi phục được phiên đăng nhập: ${error.message}`);
      void updateAdminStatus(data.session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      window.setTimeout(() => void updateAdminStatus(nextSession), 0);
    });
    void loadPlaces();
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const dialog = detailDialog.current;
    if (!dialog) return;
    if (selected && !dialog.open) dialog.showModal();
    if (!selected && dialog.open) dialog.close();
  }, [selected]);

  useEffect(() => {
    const dialog = loginDialog.current;
    if (!dialog) return;
    if (loginOpen && !dialog.open) dialog.showModal();
    if (!loginOpen && dialog.open) dialog.close();
  }, [loginOpen]);

  useEffect(() => {
    const dialog = editorDialog.current;
    if (!dialog) return;
    if (editorOpen && !dialog.open) dialog.showModal();
    if (!editorOpen && dialog.open) dialog.close();
  }, [editorOpen]);

  useEffect(() => {
    const urls = draft.pendingPhotos.map((file) => URL.createObjectURL(file));
    setPendingPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [draft.pendingPhotos]);

  function beginCreate() {
    setSelected(null);
    setEditing(null);
    setDraft(emptyDraft());
    setFormError('');
    setEditorOpen(true);
  }

  function beginEdit(place: RecommendedPlace) {
    setSelected(null);
    setEditing(place);
    setDraft({ ...place, pendingPhotos: [] });
    setFormError('');
    setEditorOpen(true);
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setFormError('');
    setSaving(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setSaving(false);
    if (error) setFormError(`Đăng nhập không thành công: ${error.message}`);
    else {
      setPassword('');
      setLoginOpen(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    setMessage(error ? `Không đăng xuất được: ${error.message}` : 'Đã đăng xuất tài khoản quản trị.');
  }

  async function savePlace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !isAdmin) return;
    if (!draft.name.trim()) {
      setFormError('Vui lòng nhập tên quán.');
      return;
    }
    setSaving(true);
    setFormError('');
    const id = draft.id || crypto.randomUUID();
    const uploadedPaths: string[] = [];
    let photoCleanupWarning = '';
    try {
      for (const file of draft.pendingPhotos) {
        const extension = file.name.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'jpg';
        const path = `${id}/${crypto.randomUUID()}.${extension}`;
        const { error } = await supabase.storage.from(recommendationPhotoBucket).upload(path, file, {
          cacheControl: '3600',
          contentType: file.type,
          upsert: false,
        });
        if (error) throw error;
        uploadedPaths.push(path);
      }

      const payload = {
        name: draft.name.trim(),
        address: draft.address.trim(),
        price_range: draft.price_range.trim(),
        real_review: draft.real_review.trim(),
        signature_dishes: draft.signature_dishes.trim(),
        hygiene: draft.hygiene.trim(),
        ambience: draft.ambience.trim(),
        suitable_hours: draft.suitable_hours.trim(),
        photos: [...draft.photos, ...uploadedPaths],
      };
      const result = editing
        ? await supabase.from('recommended_places').update(payload).eq('id', id)
        : await supabase.from('recommended_places').insert({ id, ...payload });
      if (result.error) throw result.error;

      const removedPhotos = editing?.photos.filter((path) => !draft.photos.includes(path)) || [];
      if (removedPhotos.length) {
        const { error } = await supabase.storage.from(recommendationPhotoBucket).remove(removedPhotos);
        if (error) photoCleanupWarning = `Đã lưu nội dung nhưng chưa xóa được một số ảnh cũ: ${error.message}`;
      }
      setEditorOpen(false);
      setEditing(null);
      await loadPlaces();
      if (photoCleanupWarning) setMessage(photoCleanupWarning);
    } catch (error) {
      if (uploadedPaths.length) await supabase.storage.from(recommendationPhotoBucket).remove(uploadedPaths);
      setFormError(`Không lưu được nội dung: ${errorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  }

  async function deletePlace() {
    if (!supabase || !isAdmin || !editing) return;
    if (!window.confirm(`Xóa “${editing.name}” khỏi danh sách gợi ý?`)) return;
    setSaving(true);
    const { error } = await supabase.from('recommended_places').delete().eq('id', editing.id);
    if (error) setFormError(`Không xóa được quán: ${error.message}`);
    else {
      let photoCleanupWarning = '';
      if (editing.photos.length) {
        const { error: storageError } = await supabase.storage.from(recommendationPhotoBucket).remove(editing.photos);
        if (storageError) photoCleanupWarning = `Đã xóa quán nhưng chưa dọn được một số ảnh: ${storageError.message}`;
      }
      setEditorOpen(false);
      setEditing(null);
      await loadPlaces();
      if (photoCleanupWarning) setMessage(photoCleanupWarning);
    }
    setSaving(false);
  }

  function addPhotos(files: FileList | null) {
    if (!files) return;
    const selectedFiles = Array.from(files);
    if (draft.photos.length + draft.pendingPhotos.length + selectedFiles.length > 8) {
      setFormError('Mỗi quán có thể có tối đa 8 ảnh.');
      return;
    }
    const supportedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
    const invalid = selectedFiles.find((file) => !supportedTypes.has(file.type) || file.size > 8 * 1024 * 1024);
    if (invalid) {
      setFormError('Chỉ nhận ảnh JPEG, PNG, WebP hoặc AVIF tối đa 8 MB mỗi ảnh.');
      return;
    }
    setFormError('');
    setDraft((current) => ({ ...current, pendingPhotos: [...current.pendingPhotos, ...selectedFiles] }));
  }

  return (
    <section className="recommendation-section" aria-labelledby="recommendation-title">
      <header className="recommendation-heading">
        <div>
          <p className="eyebrow">TRẢI NGHIỆM LOCAFOOD</p>
          <h2 id="recommendation-title">Danh sách gợi ý</h2>
        </div>
        <div className="recommendation-actions">
          {isAdmin ? (
            <>
              <button className="recommendation-add" type="button" onClick={beginCreate}>Thêm quán</button>
              <button className="recommendation-auth" type="button" onClick={() => void signOut()}>Đăng xuất</button>
            </>
          ) : signedIn ? (
            <button className="recommendation-auth" type="button" onClick={() => void signOut()}>Đăng xuất</button>
          ) : (
            <button
              className="recommendation-auth"
              type="button"
              disabled={!supabaseConfigured}
              onClick={() => { setFormError(''); setLoginOpen(true); }}
            >
              Đăng nhập
            </button>
          )}
        </div>
      </header>

      {!supabaseConfigured && (
        <p className="recommendation-notice">Danh sách cần kết nối Supabase. Chủ quán có thể cấu hình URL và khóa public trong tệp môi trường.</p>
      )}
      {message && <p className="recommendation-message" role="status">{message}</p>}
      {loading && <p className="recommendation-empty">Đang tải danh sách gợi ý…</p>}
      {!loading && supabaseConfigured && !message && places.length === 0 && (
        <p className="recommendation-empty">Chưa có quán trong danh sách. Những địa điểm được thêm sẽ xuất hiện tại đây.</p>
      )}
      <div className="recommendation-list">
        {places.map((place) => (
          <article className="recommendation-card" key={place.id}>
            {place.photos[0]
              ? <img className="recommendation-cover" src={publicPhotoUrl(place.photos[0])} alt={`Ảnh ${place.name}`} loading="lazy" />
              : <div className="recommendation-cover recommendation-cover-empty" aria-hidden="true">CHAY</div>}
            <div className="recommendation-card-copy">
              <h3>{place.name}</h3>
              <p>{place.address || 'Chưa cập nhật địa chỉ'}</p>
              <span>{place.price_range || 'Chưa cập nhật giá'}</span>
              <button type="button" onClick={() => setSelected(place)}>Xem chi tiết <span aria-hidden="true">→</span></button>
            </div>
          </article>
        ))}
      </div>

      <dialog
        className="recommendation-dialog"
        ref={detailDialog}
        aria-labelledby="recommendation-detail-title"
        onClose={() => setSelected(null)}
        onClick={(event) => { if (event.target === detailDialog.current) detailDialog.current?.close(); }}
      >
        {selected && (
          <div className="recommendation-dialog-body">
            <button className="recommendation-close" type="button" aria-label="Đóng chi tiết" onClick={() => detailDialog.current?.close()}>×</button>
            <p className="eyebrow">TRẢI NGHIỆM LOCAFOOD</p>
            <h2 id="recommendation-detail-title">{selected.name}</h2>
            <p className="recommendation-address">{selected.address || 'Chưa cập nhật địa chỉ'}</p>
            {selected.photos.length > 0 && (
              <div className="recommendation-gallery">
                {selected.photos.map((path, index) => (
                  <a key={path} href={publicPhotoUrl(path)} target="_blank" rel="noreferrer">
                    <img src={publicPhotoUrl(path)} alt={`${selected.name}, ảnh ${index + 1}`} />
                  </a>
                ))}
              </div>
            )}
            <dl className="recommendation-detail-fields">
              <div><dt>Giá cả</dt><dd>{selected.price_range || 'Chưa cập nhật'}</dd></div>
              <div><dt>Đánh giá thực tế</dt><dd>{selected.real_review || 'Chưa cập nhật'}</dd></div>
              <div><dt>Món đặc sản</dt><dd>{selected.signature_dishes || 'Chưa cập nhật'}</dd></div>
              <div><dt>Vệ sinh an toàn</dt><dd>{selected.hygiene || 'Chưa cập nhật'}</dd></div>
              <div><dt>Không gian / view</dt><dd>{selected.ambience || 'Chưa cập nhật'}</dd></div>
              <div><dt>Giờ mở/đóng cửa phù hợp</dt><dd>{selected.suitable_hours || 'Chưa cập nhật'}</dd></div>
            </dl>
            {isAdmin && <button className="route-button recommendation-edit" type="button" onClick={() => beginEdit(selected)}>Chỉnh sửa thông tin</button>}
          </div>
        )}
      </dialog>

      <dialog
        className="recommendation-dialog"
        ref={loginDialog}
        aria-labelledby="recommendation-login-title"
        onClose={() => setLoginOpen(false)}
        onClick={(event) => { if (event.target === loginDialog.current) loginDialog.current?.close(); }}
      >
        <form className="recommendation-dialog-body" onSubmit={(event) => void signIn(event)}>
          <button className="recommendation-close" type="button" aria-label="Đóng đăng nhập" onClick={() => loginDialog.current?.close()}>×</button>
          <p className="eyebrow">QUẢN TRỊ DANH SÁCH</p>
          <h2 id="recommendation-login-title">Đăng nhập chủ sở hữu</h2>
          <label className="form-label" htmlFor="recommendation-email">Email</label>
          <input className="form-input" id="recommendation-email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
          <label className="form-label" htmlFor="recommendation-password">Mật khẩu</label>
          <input className="form-input" id="recommendation-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
          {formError && <p className="recommendation-form-error" role="alert">{formError}</p>}
          <button className="route-button recommendation-submit" type="submit" disabled={saving}>{saving ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
          <p className="recommendation-security-note">Chỉ tài khoản được cấp quyền quản trị mới có thể thay đổi nội dung.</p>
        </form>
      </dialog>

      <dialog
        className="recommendation-dialog recommendation-editor-dialog"
        ref={editorDialog}
        aria-labelledby="recommendation-editor-title"
        onClose={() => setEditorOpen(false)}
        onClick={(event) => { if (event.target === editorDialog.current) editorDialog.current?.close(); }}
      >
        <form className="recommendation-dialog-body" onSubmit={(event) => void savePlace(event)}>
          <button className="recommendation-close" type="button" aria-label="Đóng chỉnh sửa" onClick={() => editorDialog.current?.close()}>×</button>
          <p className="eyebrow">QUẢN TRỊ DANH SÁCH</p>
          <h2 id="recommendation-editor-title">{editing ? 'Chỉnh sửa quán' : 'Thêm quán chay'}</h2>
          <label className="form-label" htmlFor="recommendation-name">Tên quán</label>
          <input className="form-input" id="recommendation-name" required maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          <label className="form-label" htmlFor="recommendation-address">Địa chỉ</label>
          <input className="form-input" id="recommendation-address" maxLength={300} value={draft.address} onChange={(event) => setDraft({ ...draft, address: event.target.value })} />
          <label className="form-label" htmlFor="recommendation-price">Giá cả</label>
          <input className="form-input" id="recommendation-price" placeholder="Ví dụ: 30.000–60.000đ/người" maxLength={160} value={draft.price_range} onChange={(event) => setDraft({ ...draft, price_range: event.target.value })} />
          <label className="form-label" htmlFor="recommendation-review">Đánh giá thực tế</label>
          <textarea className="form-input recommendation-textarea" id="recommendation-review" maxLength={2000} value={draft.real_review} onChange={(event) => setDraft({ ...draft, real_review: event.target.value })} />
          <label className="form-label" htmlFor="recommendation-dishes">Món đặc sản</label>
          <textarea className="form-input recommendation-textarea" id="recommendation-dishes" maxLength={1000} value={draft.signature_dishes} onChange={(event) => setDraft({ ...draft, signature_dishes: event.target.value })} />
          <label className="form-label" htmlFor="recommendation-hygiene">Vệ sinh an toàn</label>
          <textarea className="form-input recommendation-textarea" id="recommendation-hygiene" maxLength={1000} value={draft.hygiene} onChange={(event) => setDraft({ ...draft, hygiene: event.target.value })} />
          <label className="form-label" htmlFor="recommendation-ambience">Không gian / view</label>
          <textarea className="form-input recommendation-textarea" id="recommendation-ambience" maxLength={1000} value={draft.ambience} onChange={(event) => setDraft({ ...draft, ambience: event.target.value })} />
          <label className="form-label" htmlFor="recommendation-hours">Giờ mở/đóng cửa phù hợp</label>
          <textarea className="form-input recommendation-textarea" id="recommendation-hours" maxLength={1000} placeholder="Giờ hoạt động và khung giờ nên ghé" value={draft.suitable_hours} onChange={(event) => setDraft({ ...draft, suitable_hours: event.target.value })} />
          <label className="form-label" htmlFor="recommendation-photos">Thêm ảnh (tối đa 8 ảnh, 8 MB mỗi ảnh)</label>
          <input className="form-input recommendation-file-input" id="recommendation-photos" type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple onChange={(event) => { addPhotos(event.target.files); event.target.value = ''; }} />
          {(draft.photos.length > 0 || pendingPreviews.length > 0) && (
            <div className="recommendation-editor-gallery">
              {draft.photos.map((path) => (
                <figure key={path}>
                  <img src={publicPhotoUrl(path)} alt="Ảnh đã lưu" />
                  <button type="button" aria-label="Gỡ ảnh" onClick={() => setDraft({ ...draft, photos: draft.photos.filter((photo) => photo !== path) })}>×</button>
                </figure>
              ))}
              {pendingPreviews.map((url, index) => (
                <figure key={url}>
                  <img src={url} alt={`Ảnh mới ${index + 1}`} />
                  <button type="button" aria-label="Gỡ ảnh mới" onClick={() => setDraft({ ...draft, pendingPhotos: draft.pendingPhotos.filter((_, photoIndex) => photoIndex !== index) })}>×</button>
                </figure>
              ))}
            </div>
          )}
          {formError && <p className="recommendation-form-error" role="alert">{formError}</p>}
          <div className="recommendation-form-actions">
            {editing && <button className="recommendation-delete" type="button" disabled={saving} onClick={() => void deletePlace()}>Xóa quán</button>}
            <button className="route-button recommendation-submit" type="submit" disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu thông tin'}</button>
          </div>
        </form>
      </dialog>
    </section>
  );
}