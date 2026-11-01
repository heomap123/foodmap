import { useEffect, useRef, useState } from 'react';
import { searchPlaceBranches } from '../services/places';
import type { Place } from '../types/map';

interface PlaceDetailsDialogProps {
  place: Place | null;
  onClose: () => void;
  onSelectPlace: (place: Place) => void;
}

export function PlaceDetailsDialog({ place, onClose, onSelectPlace }: PlaceDetailsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [branches, setBranches] = useState<Place[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (place && !dialog.open) dialog.showModal();
    if (!place && dialog.open) dialog.close();
  }, [place]);

  useEffect(() => {
    if (!place?.isFoodPlace) {
      setBranches([]);
      setBranchesError('');
      return;
    }
    const controller = new AbortController();
    setBranches([]);
    setBranchesError('');
    setBranchesLoading(true);
    void searchPlaceBranches(place, controller.signal)
      .then(setBranches)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setBranchesError(error instanceof Error ? error.message : 'Không tải được danh sách chi nhánh.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setBranchesLoading(false);
      });
    return () => controller.abort();
  }, [place]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="detail-name"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) dialogRef.current.close();
      }}
    >
      {place && (
        <div className="dialog-body detail-dialog-body">
          <button className="icon-button dialog-close" type="button" aria-label="Đóng" onClick={() => dialogRef.current?.close()}>×</button>
          <p className="eyebrow">THÔNG TIN ĐỊA ĐIỂM</p>
          <h2 id="detail-name">{place.name}</h2>
          <dl className="detail-fields detail-address-fields">
            <div><dt>Địa chỉ</dt><dd>{place.address}</dd></div>
          </dl>
          {place.isFoodPlace && (
            <section className="branch-section" aria-labelledby="branch-title">
              <h3 id="branch-title">Chi nhánh khác</h3>
              {branchesLoading && <p className="branch-message" role="status">Đang tìm chi nhánh…</p>}
              {branchesError && <p className="branch-message" role="status">Không tải được chi nhánh lúc này.</p>}
              {!branchesLoading && !branchesError && branches.length === 0 && (
                <p className="branch-message">Chưa tìm thấy chi nhánh khác trong dữ liệu bản đồ.</p>
              )}
              {branches.map((branch) => (
                <button className="branch-item" key={branch.id} type="button" onClick={() => onSelectPlace(branch)}>
                  <strong>{branch.name}</strong>
                  <span>{branch.address || 'Chưa có địa chỉ OpenStreetMap'}</span>
                </button>
              ))}
            </section>
          )}
        </div>
      )}
    </dialog>
  );
}
