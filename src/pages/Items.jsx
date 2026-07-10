import { useState, useEffect } from "react";
import {
  Box, Typography, Grid, Card, CardContent, Button, TextField,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Dialog, DialogTitle, DialogContent, DialogActions,
  MenuItem, Chip, CircularProgress, Alert,
} from "@mui/material";

const API = "http://localhost:5000/api";

const formatPrice = (value) => {
  if (!value) return "₹0";
  return Number(value).toLocaleString("en-IN", {
    style: "currency", currency: "INR", maximumFractionDigits: 0,
  });
};

const calcGST = (price, gstPercent) => {
  const p = parseFloat(price) || 0;
  const g = parseFloat(gstPercent) || 0;
  return Math.round((p * g) / 100);
};

const EMPTY_FORM = {
  service_name: "", category: "", country: "",
  price: "", gst: "18", duration: "",
  documents: "", description: "", status: "Active",
};

function Items() {
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});

  const fetchItems = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.append("search", search);
      const res = await fetch(`${API}/items?${params}`);
      const data = await res.json();
      if (data.success) { setItems(data.items); setStats(data.stats); }
    } catch (err) {
      setError("Backend connect అవ్వడం లేదు!");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchItems(); }, [search]);

  const validate = (f) => {
    const e = {};
    if (!f.service_name?.trim()) e.service_name = "Service name required";
    if (!f.category) e.category = "Category required";
    if (!f.country?.trim()) e.country = "Country required";
    if (!f.price || Number(f.price) <= 0) e.price = "Valid price required";
    return e;
  };

  const handleAdd = async () => {
    const e = validate(form);
    if (Object.keys(e).length > 0) { setErrors(e); return; }
    try {
      const res = await fetch(`${API}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) { fetchItems(); setOpen(false); setForm(EMPTY_FORM); setErrors({}); }
      else alert(data.message);
    } catch { alert("Failed to add item"); }
  };

  const handleEdit = async () => {
    const e = validate(form);
    if (Object.keys(e).length > 0) { setErrors(e); return; }
    try {
      const res = await fetch(`${API}/items/${selected.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) { fetchItems(); setEditOpen(false); setErrors({}); }
      else alert(data.message);
    } catch { alert("Failed to update item"); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this item?")) return;
    try {
      const res = await fetch(`${API}/items/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) fetchItems();
      else alert(data.message);
    } catch { alert("Failed to delete"); }
  };

  const handleStatusToggle = async (item) => {
    try {
      const res = await fetch(`${API}/items/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...item, status: item.status === "Active" ? "Inactive" : "Active" }),
      });
      const data = await res.json();
      if (data.success) fetchItems();
    } catch { alert("Failed to update status"); }
  };

  const renderFormFields = (f, setF) => (
    <>
      <TextField fullWidth margin="normal" label="Service Name *"
        value={f.service_name} error={!!errors.service_name} helperText={errors.service_name}
        onChange={(e) => setF({ ...f, service_name: e.target.value })} />

      <TextField select fullWidth margin="normal" label="Category *"
        value={f.category} error={!!errors.category} helperText={errors.category}
        onChange={(e) => setF({ ...f, category: e.target.value })}>
        {["Study Visa","PR Visa","Tourist Visa","Job Seeker","Business Visa","Work Permit","Spouse Visa","Other"].map(c =>
          <MenuItem key={c} value={c}>{c}</MenuItem>)}
      </TextField>

      <TextField fullWidth margin="normal" label="Country *"
        value={f.country} error={!!errors.country} helperText={errors.country}
        onChange={(e) => setF({ ...f, country: e.target.value })} />

      <Grid container spacing={2}>
        <Grid item xs={6}>
          <TextField fullWidth margin="normal" label="Price (₹) *" type="number"
            value={f.price} error={!!errors.price}
            helperText={errors.price || (f.price ? `GST: ₹${calcGST(f.price, f.gst).toLocaleString("en-IN")}` : "")}
            onChange={(e) => setF({ ...f, price: e.target.value })} />
        </Grid>
        <Grid item xs={6}>
          <TextField select fullWidth margin="normal" label="GST %"
            value={f.gst} onChange={(e) => setF({ ...f, gst: e.target.value })}>
            {["0","5","12","18","28"].map(g => <MenuItem key={g} value={g}>{g}%</MenuItem>)}
          </TextField>
        </Grid>
      </Grid>

      {f.price && Number(f.price) > 0 && (
        <Box sx={{ bgcolor: "#f0f7ff", p: 1.5, borderRadius: 1, mb: 1 }}>
          <Typography variant="body2">
            Base: {formatPrice(f.price)} + GST({f.gst}%): ₹{calcGST(f.price, f.gst).toLocaleString("en-IN")} =
            <strong> Total: {formatPrice(Number(f.price) + calcGST(f.price, f.gst))}</strong>
          </Typography>
        </Box>
      )}

      <TextField fullWidth margin="normal" label="Duration (e.g. 3 Months)"
        value={f.duration} onChange={(e) => setF({ ...f, duration: e.target.value })} />
      <TextField fullWidth multiline rows={2} margin="normal" label="Required Documents"
        value={f.documents} onChange={(e) => setF({ ...f, documents: e.target.value })} />
      <TextField fullWidth multiline rows={2} margin="normal" label="Description"
        value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <TextField select fullWidth margin="normal" label="Status"
        value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
        <MenuItem value="Active">Active</MenuItem>
        <MenuItem value="Inactive">Inactive</MenuItem>
      </TextField>
    </>
  );

  return (
    <Box>
      <Typography variant="h4" fontWeight="bold" sx={{ mb: 3 }}>Services / Items</Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Grid container spacing={3} sx={{ mb: 3 }}>
        {[
          { label: "Total Services", value: stats.total_items || 0, color: "#1976d2" },
          { label: "Active Services", value: stats.active_items || 0, color: "#2e7d32" },
          { label: "Most Sold", value: "Study Visa", color: "#ed6c02" },
          { label: "Revenue", value: formatPrice(stats.total_revenue || 0), color: "#9c27b0" },
        ].map((stat) => (
          <Grid item xs={12} md={3} key={stat.label}>
            <Card sx={{ borderLeft: `4px solid ${stat.color}` }}>
              <CardContent>
                <Typography color="text.secondary">{stat.label}</Typography>
                <Typography variant="h5" fontWeight="bold" color={stat.color}>{stat.value}</Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 3 }}>
        <TextField label="Search Service" size="small" value={search}
          onChange={(e) => setSearch(e.target.value)} sx={{ width: 300 }} />
        <Button variant="contained" onClick={() => { setForm(EMPTY_FORM); setErrors({}); setOpen(true); }}>
          + Add Service
        </Button>
      </Box>

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <TableContainer component={Paper}>
          <Table>
            <TableHead sx={{ bgcolor: "#f5f5f5" }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Service</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Category</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Country</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Price</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>GST</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Total</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 4, color: "text.secondary" }}>
                    No items found. "+ Add Service" click చేయి!
                  </TableCell>
                </TableRow>
              )}
              {items.map((item) => (
                <TableRow key={item.id} hover>
                  <TableCell>{item.service_name}</TableCell>
                  <TableCell>{item.category}</TableCell>
                  <TableCell>{item.country}</TableCell>
                  <TableCell>{formatPrice(item.price)}</TableCell>
                  <TableCell>{item.gst}%</TableCell>
                  <TableCell>{formatPrice(Number(item.price) + calcGST(item.price, item.gst))}</TableCell>
                  <TableCell>
                    <Chip
                      label={item.status}
                      color={item.status === "Active" ? "success" : "default"}
                      size="small" sx={{ cursor: "pointer" }}
                      onClick={() => handleStatusToggle(item)}
                    />
                  </TableCell>
                  <TableCell>
                    <Button size="small" onClick={() => { setSelected(item); setViewOpen(true); }}>View</Button>
                    <Button size="small" color="primary" onClick={() => {
                      setSelected(item);
                      setForm({
                        service_name: item.service_name,
                        category: item.category,
                        country: item.country,
                        price: item.price,
                        gst: item.gst,
                        duration: item.duration || "",
                        documents: item.documents || "",
                        description: item.description || "",
                        status: item.status,
                      });
                      setErrors({});
                      setEditOpen(true);
                    }}>Edit</Button>
                    <Button size="small" color="error" onClick={() => handleDelete(item.id)}>Delete</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* ADD Dialog */}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Add New Service</DialogTitle>
        <DialogContent>{renderFormFields(form, setForm)}</DialogContent>
        <DialogActions>
          <Button onClick={() => { setOpen(false); setErrors({}); }}>Cancel</Button>
          <Button variant="contained" onClick={handleAdd}>Save Service</Button>
        </DialogActions>
      </Dialog>

      {/* EDIT Dialog */}
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Edit Service</DialogTitle>
        <DialogContent>{renderFormFields(form, setForm)}</DialogContent>
        <DialogActions>
          <Button onClick={() => { setEditOpen(false); setErrors({}); }}>Cancel</Button>
          <Button variant="contained" onClick={handleEdit}>Update Service</Button>
        </DialogActions>
      </Dialog>

      {/* VIEW Dialog */}
      <Dialog open={viewOpen} onClose={() => setViewOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Service Details</DialogTitle>
        <DialogContent>
          {selected && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mt: 1 }}>
              {[
                ["Item ID", selected.item_id],
                ["Service Name", selected.service_name],
                ["Category", selected.category],
                ["Country", selected.country],
                ["Base Price", formatPrice(selected.price)],
                ["GST", `${selected.gst}% (₹${calcGST(selected.price, selected.gst).toLocaleString("en-IN")})`],
                ["Total (with GST)", formatPrice(Number(selected.price) + calcGST(selected.price, selected.gst))],
                ["Duration", selected.duration || "—"],
                ["Documents", selected.documents || "—"],
                ["Description", selected.description || "—"],
                ["Status", selected.status],
              ].map(([label, value]) => (
                <Box key={label} sx={{ display: "flex", gap: 1 }}>
                  <Typography fontWeight="bold" sx={{ minWidth: 150 }}>{label}:</Typography>
                  <Typography>{value}</Typography>
                </Box>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default Items;