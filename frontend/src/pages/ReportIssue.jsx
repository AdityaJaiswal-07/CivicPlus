
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FaArrowLeft,
  FaMapMarkerAlt,
  FaCamera,
  FaTrashAlt,
  FaCheckCircle,
} from "react-icons/fa";
import { useAuth } from "../auth/AuthContext";
import { ApiError, errorMessage } from "../lib/api";
import Alert from "../components/Alert";
import "./ReportIssue.css";

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

function ReportIssue() {
  const navigate = useNavigate();
  const { api, getSupabase } = useAuth();

  const [form, setForm] = useState({
    title: "",
    categoryId: "",
    location: "",
    description: "",
  });
  const [categories, setCategories] = useState([]);
  const [catState, setCatState] = useState("loading"); // loading | ready | error
  const [photo, setPhoto] = useState(null);
  const [photoError, setPhotoError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const loadCategories = useCallback(async () => {
    setCatState("loading");
    try {
      setCategories(await api.get("/categories"));
      setCatState("ready");
    } catch (err) {
      setError(errorMessage(err));
      setCatState("error");
    }
  }, [api]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    setFieldErrors({ ...fieldErrors, [e.target.name]: undefined });
  };

  const validate = () => {
    const errs = {};
    const title = form.title.trim();
    if (title.length < 3) errs.title = "Title must be at least 3 characters.";
    if (!form.categoryId) errs.categoryId = "Please choose a category.";
    if (form.location.trim().length < 3) errs.location = "Please enter a location (at least 3 characters).";
    if (form.description.trim().length < 10) errs.description = "Please describe the issue in at least 10 characters.";
    return errs;
  };

  const uploadPhoto = async (file) => {
    const slot = await api.post("/reports/photos/upload-url", {
      contentType: file.type,
      sizeBytes: file.size,
    });
    const { error: upErr } = await getSupabase()
      .storage.from("report-photos")
      .uploadToSignedUrl(slot.path, slot.token, file, { contentType: file.type });
    if (upErr) throw new Error("The photo could not be uploaded. Please try again or remove it.");
    return slot.path;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;

    setBusy(true);
    try {
      const photoPaths = photo ? [await uploadPhoto(photo)] : undefined;
      await api.post("/reports", {
        categoryId: form.categoryId,
        title: form.title.trim(),
        description: form.description.trim(),
        addressText: form.location.trim(),
        ...(photoPaths ? { photoPaths } : {}),
      });
      setMessage("Your complaint has been submitted successfully!");
      setTimeout(() => navigate("/citizen/dashboard"), 1200);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        const fe = err.fieldErrors;
        setFieldErrors({
          title: fe.title,
          categoryId: fe.categoryId,
          location: fe.addressText,
          description: fe.description,
        });
      }
      setError(
        err instanceof ApiError && err.status === 403
          ? "Your account can't submit reports yet. Please verify your email address first."
          : errorMessage(err)
      );
      setBusy(false);
    }
  };

  const handlePhoto = (e) => {
    const file = e.target.files?.[0];
    setPhotoError("");
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) {
      setPhotoError("Please choose a JPG, PNG or WEBP image.");
    } else if (file.size > MAX_PHOTO_BYTES) {
      setPhotoError("Please select an image smaller than 5 MB.");
    } else {
      setPhoto(file);
      return;
    }
    e.target.value = "";
    setPhoto(null);
  };

  return (
    <div className="issue-page">
      <header className="issue-header">
        <button
          className="issue-back"
          onClick={() => navigate("/citizen/dashboard")}
        >
          <FaArrowLeft /> Back to Dashboard
        </button>
        <strong>CivicPlus<span>+</span></strong>
      </header>

      <main className="issue-container">
        <div className="issue-intro">
          <span className="issue-eyebrow">CITIZEN PORTAL</span>
          <h1>Report a Garbage Issue</h1>
          <p>
            Help keep your neighbourhood clean. Share the details below
            so your municipality can take action.
          </p>
        </div>

        {message && (
          <div className="issue-success">
            <FaCheckCircle /> {message}
          </div>
        )}

        <form className="issue-form" onSubmit={handleSubmit} noValidate>
          <Alert type="error">{error}</Alert>
          <div className="issue-form-heading">
            <h2>Complaint Details</h2>
            <p>Fields marked * are required.</p>
          </div>

          <div className="issue-field">
            <label htmlFor="title">Complaint title *</label>
            <input
              id="title"
              name="title"
              value={form.title}
              onChange={handleChange}
              placeholder="e.g. Garbage overflowing near road"
              required
              maxLength={150}
            />
            {fieldErrors.title && <small className="issue-error">{fieldErrors.title}</small>}
          </div>

          <div className="issue-field">
            <label htmlFor="category">Waste category *</label>
            <select
              id="category"
              name="categoryId"
              value={form.categoryId}
              onChange={handleChange}
              required
              disabled={catState !== "ready"}
            >
              <option value="">
                {catState === "loading" ? "Loading categories…" : "Select a category"}
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {catState === "error" && (
              <button type="button" className="issue-cancel" onClick={loadCategories}>
                Retry loading categories
              </button>
            )}
            {fieldErrors.categoryId && <small className="issue-error">{fieldErrors.categoryId}</small>}
          </div>

          <div className="issue-field">
            <label htmlFor="location">Location / address *</label>
            <div className="issue-input-icon">
              <FaMapMarkerAlt />
              <input
                id="location"
                name="location"
                value={form.location}
                onChange={handleChange}
                placeholder="Enter street, area or landmark"
                required
                maxLength={300}
              />
            </div>
            {fieldErrors.location && <small className="issue-error">{fieldErrors.location}</small>}
          </div>

          <div className="issue-field">
            <label htmlFor="description">Describe the issue *</label>
            <textarea
              id="description"
              name="description"
              value={form.description}
              onChange={handleChange}
              placeholder="Describe the garbage problem and nearby landmarks..."
              rows={5}
              required
              maxLength={2000}
            />
            {fieldErrors.description && <small className="issue-error">{fieldErrors.description}</small>}
          </div>

          <div className="issue-field">
            <label htmlFor="photo">Upload a photo (optional)</label>
            <label className="issue-upload" htmlFor="photo">
              <FaCamera />
              <span>
                <strong>{photo ? photo.name : "Choose an image"}</strong>
                <small>JPG, PNG or WEBP · Maximum 5 MB</small>
              </span>
            </label>
            <input
              className="issue-file-input"
              id="photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handlePhoto}
            />
            {photoError && <small className="issue-error">{photoError}</small>}
          </div>

          <div className="issue-actions">
            <button
              type="button"
              className="issue-cancel"
              onClick={() => navigate("/citizen/dashboard")}
              disabled={busy}
            >
              Cancel
            </button>

            <button type="submit" className="issue-submit" disabled={busy || catState !== "ready"}>
              <FaTrashAlt /> {busy ? "Submitting…" : "Submit Complaint"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}

export default ReportIssue;
