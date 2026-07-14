const transporter = require('../config/email');

const emailService = {

  sendChairmanApprovalMail: async (invoice) => {
    const approveUrl =
      `https://vjc-invoice-backend.vercel.app/api/invoices/approve/${invoice.chairman_token}`;

    const rejectUrl =
      `https://vjc-invoice-backend.vercel.app/api/invoices/reject/${invoice.chairman_token}`;

    const html = `
<style>
  @media only screen and (max-width: 600px) {
    .vjc-stack-table, .vjc-stack-table tr, .vjc-stack-table td {
      display: block !important;
      width: 100% !important;
      box-sizing: border-box !important;
    }
    .vjc-btn-wrap a {
      display: block !important;
      width: 100% !important;
      box-sizing: border-box !important;
      margin: 8px 0 !important;
      text-align: center !important;
    }
  }
</style>
<div style="font-family:Arial,sans-serif;background:#f4f6f9;padding:20px;">
  <div style="max-width:900px;margin:auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #ddd;">

    <div style="background:#0f9d94;color:#fff;padding:18px 25px;position:relative;">

  <img
    src="https://vjc-invoice-backend.vercel.app/vjc-overseas-logo.png"
    style="height:55px;display:block;"
  />

  <h2 style="margin:15px 0 5px;">
    Invoice Approval Request
  </h2>

  <div
    style="
      display:inline-block;
      background:#fff3cd;
      color:#856404;
      padding:6px 12px;
      border-radius:20px;
      font-size:13px;
      font-weight:bold;
    ">
    🟡 Pending Approval
  </div>

</div>

<div style="padding:20px 25px 0 25px;
font-size:15px;
color:#555;
line-height:24px;">

Dear Chairman,

<br><br>

A new invoice has been created and is awaiting your approval.

Please review the invoice details below before approving or rejecting it.

</div>

<div style="padding:25px;">
  <table style="width:100%;border-collapse:collapse;font-size:14px;">
    <tr style="background:#f8f9fa;">
      <td style="padding:10px 14px;font-weight:700;width:40%;color:#444;">Client Name</td>
      <td style="padding:10px 14px;">${invoice.customer_name}</td>
    </tr>
    <tr>
      <td style="padding:10px 14px;font-weight:700;color:#444;">Invoice Number</td>
      <td style="padding:10px 14px;">${invoice.invoice_number}</td>
    </tr>
    ${invoice.customer_gstin ? `
    <tr style="background:#f8f9fa;">
      <td style="padding:10px 14px;font-weight:700;color:#444;">GSTIN</td>
      <td style="padding:10px 14px;">${invoice.customer_gstin}</td>
    </tr>` : ''}
    ${invoice.customer_address ? `
    <tr>
      <td style="padding:10px 14px;font-weight:700;color:#444;">Address</td>
      <td style="padding:10px 14px;">${invoice.customer_address}</td>
    </tr>` : ''}
    <tr style="background:#f8f9fa;">
      <td style="padding:10px 14px;font-weight:700;color:#444;">Subtotal</td>
      <td style="padding:10px 14px;">₹${Number(invoice.subtotal || 0).toLocaleString('en-IN')}</td>
    </tr>
    <tr>
      <td style="padding:10px 14px;font-weight:700;color:#444;">Paid Amount</td>
      <td style="padding:10px 14px;color:#2e7d32;font-weight:700;">₹${Number(invoice.paid_amount || 0).toLocaleString('en-IN')}</td>
    </tr>
    <tr style="background:#f8f9fa;">
      <td style="padding:10px 14px;font-weight:700;color:#444;">Tax %</td>
      <td style="padding:10px 14px;">${invoice.tax_percent || 0}%</td>
    </tr>
    <tr>
      <td style="padding:10px 14px;font-weight:700;color:#444;">Balance Amount</td>
      <td style="padding:10px 14px;color:#d32f2f;font-weight:700;">₹${Number(invoice.balance_amount || 0).toLocaleString('en-IN')}</td>
    </tr>
    <tr style="background:#f8f9fa;">
      <td style="padding:10px 14px;font-weight:700;color:#444;">Tax Amount</td>
      <td style="padding:10px 14px;">₹${Number(invoice.tax_amount || 0).toLocaleString('en-IN')}</td>
    </tr>
    <tr>
      <td style="padding:10px 14px;font-weight:700;color:#444;">Due Date</td>
      <td style="padding:10px 14px;">${invoice.due_date ? new Date(invoice.due_date).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '-'}</td>
    </tr>
    ${invoice.notes ? `
    <tr style="background:#f8f9fa;">
      <td style="padding:10px 14px;font-weight:700;color:#444;">Description</td>
      <td style="padding:10px 14px;">${invoice.notes}</td>
    </tr>` : ''}
  </table>
${invoice.screenshot_base64 ? `
<div style="margin-top:25px;">

<h3
style="
margin-bottom:10px;
color:#1976d2;
">

Payment Screenshot

</h3>

<img
src="${invoice.screenshot_base64}"
style="
width:100%;
border:1px solid #ddd;
border-radius:8px;
"
/>

</div>
` : ''}
<div style="margin-top:30px;text-align:center;">
  <a href="${approveUrl}" style="display:inline-block;background:#2e7d32;color:#fff;
    padding:14px 0;text-decoration:none;border-radius:6px;font-size:16px;
    font-weight:700;width:45%;max-width:180px;margin:6px;">
    ✅ APPROVE
  </a>
  <a href="${rejectUrl}" style="display:inline-block;background:#d32f2f;color:#fff;
    padding:14px 0;text-decoration:none;border-radius:6px;font-size:16px;
    font-weight:700;width:45%;max-width:180px;margin:6px;">
    ❌ REJECT
  </a>
</div>

          </div>

<hr style="margin-top:35px;border:none;border-top:1px solid #ddd;">

<div
style="
padding:18px;
text-align:center;
font-size:13px;
color:#666;
">

Regards,

<br><br>

<b>VJC Overseas</b>

</div>

    </div>
  </div>
</div>
    `;

    await transporter.sendMail({
      from: `"VJC Invoice" <${process.env.EMAIL_USER}>`,
      to: process.env.CHAIRMAN_EMAIL,
     subject:
`Invoice Approval Required - ${invoice.invoice_number}`,
      html,
    });
    console.log('✅ Chairman mail sent!');
  },

  sendClientInvoiceMail: async (invoice) => {
    // ── derive CGST / SGST split (matches the PDF invoice template) ────────
    const taxAmountTotal = Number(invoice.tax_amount || 0);
const isIGST = (invoice.tax_type || "CGST_SGST") === "IGST";
    const halfTaxPercent = (Number(invoice.tax_percent || 0) / 2).toFixed(0);
    const cgstAmount = (taxAmountTotal / 2);
    const sgstAmount = (taxAmountTotal / 2);

    const grandTotalNum = Number(invoice.grand_total || invoice.total_amount || 0);
    const subtotalNum = Number(invoice.subtotal || 0);
    const invoiceAmountNum = Number(
      invoice.invoice_amount ?? (subtotalNum - taxAmountTotal)
    );

    // Amount in words (simple Indian numbering, integer rupees only)
    const numberToWords = (num) => {
      const a = [
        '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
        'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
        'Eighteen', 'Nineteen',
      ];
      const b = [
        '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
      ];
      const inWords = (n) => {
        if (n < 20) return a[n];
        if (n < 100) return b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : '');
        if (n < 1000)
          return a[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + inWords(n % 100) : '');
        if (n < 100000)
          return inWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + inWords(n % 1000) : '');
        if (n < 10000000)
          return inWords(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + inWords(n % 100000) : '');
        return inWords(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + inWords(n % 10000000) : '');
      };
      const intPart = Math.round(num);
      if (intPart === 0) return 'Zero';
      return inWords(intPart);
    };

    const grandTotalWords = `${numberToWords(grandTotalNum)} Only`;
    const currency = invoice.currency || 'INR';

  const html = `
<head>
<style>
  @media only screen and (max-width: 600px) {
    .vjc-stack-table, .vjc-stack-table tr, .vjc-stack-table td {
      display: block !important;
      width: 100% !important;
      box-sizing: border-box !important;
      text-align: left !important;
    }
    .vjc-logo {
      height: 75px !important;
    }
    .vjc-label {
      white-space: normal !important;
    }
    .vjc-outer-pad {
      padding-left: 14px !important;
      padding-right: 14px !important;
    }
  }
  @media only screen and (min-width: 601px) and (max-width: 820px) {
    .vjc-logo {
      height: 80px !important;
    }
  }
</style>
</head>
<body>
<div style="font-family:Arial,Helvetica,sans-serif;background:#eef1f4;padding:20px;">
  <div class="vjc-outer-pad" style="max-width:760px;margin:auto;background:#fff;border:1px solid #e2e2e2;border-radius:4px;overflow:hidden;">

    <div style="height:5px;background:#1976d2;"></div>

    <!-- Header -->
    <table class="vjc-stack-table" style="width:100%;border-collapse:collapse;padding:0;">
      <tr>
<td style="vertical-align:top;width:30%;padding:22px 0 0 28px;">
  <img
src="https://vjc-invoice-backend.vercel.app/vjc-overseas-logo.png"
    alt="VJC Overseas"
    class="vjc-logo"
    style="height:90px;display:block;margin:0;padding:0;"
  />
</td>
        <td style="vertical-align:top;width:70%;text-align:right;padding:22px 28px 0 0;">
          <div style="font-size:24px;font-weight:800;color:#111;letter-spacing:0.5px;">INVOICE</div>
          <div style="font-size:12.5px;font-weight:700;color:#222;margin-top:5px;">
            VJC Immigration And Visa Consultants Pvt. Ltd.,
          </div>
          <div style="font-size:11.5px;color:#555;margin-top:3px;line-height:1.5;">
            GST No: ${invoice.company_gstin || '36AAFCV2627Q1ZR'}<br/>
            Company Number: ${invoice.company_phone || '+919160449000'}<br/>
            Email: ${invoice.company_email || 'info@vjcoverseas.com'}
          </div>
        </td>
      </tr>
    </table>

    <div style="padding:0 28px;">
      <hr style="border:none;border-top:1px solid #e6e6e6;margin:4px 0 12px 0;" />
    </div>
    <!-- Bill To / Invoice meta -->
    <table class="vjc-stack-table" style="width:100%;border-collapse:collapse;padding:0 28px;">
      <tr>
        <td style="vertical-align:top;width:55%;padding:0 0 0 28px;">
          <div style="font-size:13px;font-weight:700;color:#222;margin-bottom:7px;">Bill To</div>
          <table style="font-size:12px;color:#333;border-collapse:collapse;">
<tr><td class="vjc-label" style="font-weight:700;padding:2px 6px 2px 0;white-space:nowrap;">Name :</td><td style="padding:2px 0;">${invoice.customer_name || '-'}</td></tr>           <tr><td class="vjc-label" style="font-weight:700;padding:2px 6px 2px 0;white-space:nowrap;">Email :</td><td style="padding:2px 0;">${invoice.customer_email || '-'}</td></tr>
            <tr><td class="vjc-label" style="font-weight:700;padding:2px 6px 2px 0;white-space:nowrap;">Mobile :</td><td style="padding:2px 0;">${invoice.customer_phone || '-'}</td></tr>
<tr><td class="vjc-label" style="font-weight:700;padding:2px 6px 2px 0;white-space:nowrap;vertical-align:top;">Address :</td><td style="padding:2px 0;">${invoice.customer_address || '-'}</td></tr>
          </table>
        </td>
        <td style="vertical-align:top;width:45%;padding:0 28px 0 0;">
          <table class="vjc-stack-table" style="font-size:12px;color:#333;border-collapse:collapse;margin-left:auto;">
            <tr><td class="vjc-label" style="font-weight:700;padding:2px 6px 2px 0;white-space:nowrap;">Client ID :</td><td style="padding:2px 0;text-align:right;">${invoice.customer_id || '-'}</td></tr>
            <tr><td class="vjc-label" style="font-weight:700;padding:2px 6px 2px 0;white-space:nowrap;">Service Type :</td><td style="padding:2px 0;text-align:right;">${invoice.service_type || '-'}</td></tr>
            <tr><td class="vjc-label" style="font-weight:700;padding:2px 6px 2px 0;white-space:nowrap;">Invoice Number :</td><td style="padding:2px 0;text-align:right;">${invoice.invoice_number || '-'}</td></tr>
<tr><td class="vjc-label" style="font-weight:700;padding:2px 6px 2px 0;white-space:nowrap;">Invoice Date :</td><td style="padding:2px 0;text-align:right;">${invoice.invoice_date ? new Date(invoice.invoice_date).toLocaleDateString("en-GB").replace(/\//g, "-") : "-"}</td></tr>            <tr><td class="vjc-label" style="font-weight:700;padding:2px 6px 2px 0;white-space:nowrap;vertical-align:top;">Service Type :</td><td style="padding:2px 0;text-align:right;">${invoice.notes || invoice.service_type || '-'}</td></tr>
          </table>
        </td>
      </tr>
    </table>

   <!-- Totals -->
    <div style="padding:22px 28px 0 28px;">
      <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
<tr>
  <td style="padding:4px 0;color:#333;font-weight:600;">Sub Total :</td>
  <td style="padding:4px 0;text-align:right;font-weight:700;color:#222;">
    INR ${subtotalNum.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
  </td>
</tr>

<tr>
  <td style="padding:4px 0;color:#333;font-weight:600;">Invoice Amount :</td>
  <td style="padding:4px 0;text-align:right;font-weight:700;color:#222;">
    INR ${invoiceAmountNum.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
  </td>
</tr>

${isIGST ? `
<tr>
  <td style="padding:4px 0;color:#333;font-weight:600;">IGST (${invoice.tax_percent || 18}%) :</td>
  <td style="padding:4px 0;text-align:right;font-weight:700;color:#222;">
    INR ${taxAmountTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
  </td>
</tr>
` : `
<tr>
  <td style="padding:4px 0;color:#333;font-weight:600;">CGST (${halfTaxPercent}%) :</td>
  <td style="padding:4px 0;text-align:right;font-weight:700;color:#222;">
    INR ${cgstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
  </td>
</tr>

<tr>
  <td style="padding:4px 0;color:#333;font-weight:600;">SGST (${halfTaxPercent}%) :</td>
  <td style="padding:4px 0;text-align:right;font-weight:700;color:#222;">
    INR ${sgstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
  </td>
</tr>
`}
        ${Number(invoice.paid_amount || 0) > 0 ? `
        <tr style="background:#f0fdf4;">
          <td style="padding:4px 0 4px 6px;color:#16a34a;font-weight:700;">Paid Amount:</td>
          <td style="padding:4px 6px 4px 0;text-align:right;font-weight:700;color:#16a34a;">
 INR ${Number(invoice.paid_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </td>
        </tr>
        <tr style="background:#fff3f0;">
          <td style="padding:4px 0 10px 6px;color:#d32f2f;font-weight:700;">Balance Amount:</td>
          <td style="padding:4px 6px 10px 0;text-align:right;font-weight:700;color:#d32f2f;">
INR ${Number(invoice.balance_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}          </td>
        </tr>` : ''}
      </table>
      <hr style="border:none;border-top:1px solid #e6e6e6;margin:0 0 8px 0;" />
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:2px 0;font-size:14px;font-weight:800;color:#111;">Grand Total :</td>
          <td style="padding:2px 0;text-align:right;font-size:14px;font-weight:800;color:#1565c0;">
 INR ${grandTotalNum.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </td>
        </tr>
      </table>
      <div style="text-align:right;font-size:11.5px;color:#555;margin-top:3px;">
        Grand Total in Word : <strong>${grandTotalWords}</strong>
      </div>
      ${Number(invoice.paid_amount || 0) > 0 ? `
      <div style="margin-top:6px;text-align:right;font-size:11.5px;color:#16a34a;font-weight:700;">
        Paid Amount in Word : <strong>${numberToWords(Number(invoice.paid_amount))} Only</strong>
      </div>` : ''}
    </div>

    <!-- Description -->
    ${invoice.notes ? `
    <div style="padding:16px 28px 0 28px;">
      <div style="font-size:13px;font-weight:700;color:#222;margin-bottom:5px;">Description</div>
      <div style="font-size:12px;color:#555;background:#f8f9fa;padding:10px 14px;border-radius:4px;line-height:1.6;">
        ${invoice.notes}
      </div>
    </div>` : ''}
    <!-- Terms -->
    <div style="padding:20px 28px 24px 28px;">
      <div style="font-size:13px;font-weight:700;color:#222;margin-bottom:5px;">Notes / Terms &amp; Conditions</div>
      <div style="font-size:11px;color:#555;line-height:1.6;">
        <strong>Invoice Terms &amp; Conditions</strong><br/>
        <strong>Mode of Payment</strong><br/>
        Payments can be made via bank transfer, UPI, cheque, or any other method as communicated.
        All charges related to international transfers (if applicable) must be borne by the client.<br/>
        <strong>Service Delivery</strong><br/>
        Services will be rendered as per the agreed scope. VJC Overseas is not responsible for delays
        or failures due to incomplete documentation or non-cooperation by the client.<br/>
        <strong>Third-Party Charges</strong><br/>
        Any government, embassy, university, or third-party fees are not included in this invoice
        unless specifically mentioned. The client is solely responsible for paying these charges.<br/>
        <strong>Changes and Cancellations</strong><br/>
        Any changes in service scope requested after payment may result in additional charges.
        Cancellations must be made in writing and are subject to VJC Overseas' cancellation policy.<br/>
        <strong>Limitation of Liability</strong><br/>
        VJC Overseas will not be liable for any losses arising from visa rejection, university admission
        denial, or any outcome beyond our direct control.
      </div>
    </div>

    <div style="background:#111;color:#ddd;text-align:center;font-size:11px;padding:13px 18px;">
      VJC Immigration And Visa Consultants Pvt. Ltd., - 62/A, Sundari Reddy Bhavan, Ground Floor, Vengalrao Nagar,
      S.R.Nagar, Hyderabad-500038, Telangana, India.
    </div>
  </div>
</div>
</body>
    `;

    await transporter.sendMail({
      from: `"VJC Overseas" <${process.env.EMAIL_USER}>`,
      to: invoice.customer_email,
      subject: `Invoice ${invoice.invoice_number} - ₹${grandTotalNum.toLocaleString('en-IN')}`,
      html,
    });
    console.log('✅ Client mail sent!');
  },
  buildClientInvoiceHtml: (invoice) => {
    const taxAmountTotal = Number(invoice.tax_amount || 0);
const isIGST = invoice.tax_type === "IGST";
    const halfTaxPercent = (Number(invoice.tax_percent || 0) / 2).toFixed(0);
    const cgstAmount = (taxAmountTotal / 2);
    const sgstAmount = (taxAmountTotal / 2);

    const grandTotalNum = Number(invoice.grand_total || invoice.total_amount || 0);
    const subtotalNum = Number(invoice.subtotal || 0);
    const invoiceAmountNum = Number(
      invoice.invoice_amount ?? (subtotalNum - taxAmountTotal)
    );

    const numberToWords = (num) => {
      const a = [
        '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
        'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
        'Eighteen', 'Nineteen',
      ];
      const b = [
        '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
      ];
      const inWords = (n) => {
        if (n < 20) return a[n];
        if (n < 100) return b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : '');
        if (n < 1000)
          return a[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + inWords(n % 100) : '');
        if (n < 100000)
          return inWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + inWords(n % 1000) : '');
        if (n < 10000000)
          return inWords(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + inWords(n % 100000) : '');
        return inWords(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + inWords(n % 10000000) : '');
      };
      const intPart = Math.round(num);
      if (intPart === 0) return 'Zero';
      return inWords(intPart);
    };

    const grandTotalWords = `${numberToWords(grandTotalNum)} Only`;

    const html = `
<head>
<style>
  @media only screen and (max-width: 600px) {
    .vjc-stack-table, .vjc-stack-table tr, .vjc-stack-table td {
      display: block !important;
      width: 100% !important;
      box-sizing: border-box !important;
      text-align: left !important;
    }
    .vjc-logo {
      height: 75px !important;
    }
    .vjc-label {
      white-space: normal !important;
    }
    .vjc-outer-pad {
      padding-left: 14px !important;
      padding-right: 14px !important;
    }
  }
  @media only screen and (min-width: 601px) and (max-width: 820px) {
    .vjc-logo {
      height: 80px !important;
    }
  }
</style>
</head>
<body>
<div style="font-family:Arial,Helvetica,sans-serif;background:#eef1f4;padding:20px;">
  <div class="vjc-outer-pad" style="max-width:760px;margin:auto;background:#fff;border:1px solid #e2e2e2;border-radius:4px;overflow:hidden;">

    <div style="height:5px;background:#1976d2;"></div>

    <table class="vjc-stack-table" style="width:100%;border-collapse:collapse;padding:0;">
      <tr>
<td style="vertical-align:top;width:30%;padding:22px 0 0 28px;">
  <img
src="https://vjc-invoice-backend.vercel.app/vjc-overseas-logo.png"
    alt="VJC Overseas"
    class="vjc-logo"
    style="height:90px;display:block;margin:0;padding:0;"
  />
</td>
        <td style="vertical-align:top;width:70%;text-align:right;padding:22px 28px 0 0;">
          <div style="font-size:24px;font-weight:800;color:#111;letter-spacing:0.5px;">INVOICE</div>
          <div style="font-size:12.5px;font-weight:700;color:#222;margin-top:5px;">
            VJC Immigration And Visa Consultants Pvt. Ltd.,
          </div>
          <div style="font-size:11.5px;color:#555;margin-top:3px;line-height:1.5;">
            GST No: ${invoice.company_gstin || '36AAFCV2627Q1ZR'}<br/>
            Company Number: ${invoice.company_phone || '+919160449000'}<br/>
            Email: ${invoice.company_email || 'info@vjcoverseas.com'}
          </div>
        </td>
      </tr>
    </table>

    <div style="padding:0 28px;">
      <hr style="border:none;border-top:1px solid #e6e6e6;margin:4px 0 12px 0;" />
    </div>
    <table class="vjc-stack-table" style="width:100%;border-collapse:collapse;padding:0 28px;">
      <tr>
        <td style="vertical-align:top;width:55%;padding:0 0 0 28px;">
          <div style="font-size:13px;font-weight:700;color:#222;margin-bottom:7px;">Bill To</div>
          <table style="font-size:12px;color:#333;border-collapse:collapse;">
<tr><td class="vjc-label" style="font-weight:700;padding:2px 6px 2px 0;white-space:nowrap;">Name :</td><td style="padding:2px 0;">${invoice.customer_name || '-'}</td></tr>           <tr><td class="vjc-label" style="font-weight:700;padding:2px 6px 2px 0;white-space:nowrap;">Email :</td><td style="padding:2px 0;">${invoice.customer_email || '-'}</td></tr>
            <tr><td class="vjc-label" style="font-weight:700;padding:2px 6px 2px 0;white-space:nowrap;">Mobile :</td><td style="padding:2px 0;">${invoice.customer_phone || '-'}</td></tr>
<tr><td class="vjc-label" style="font-weight:700;padding:2px 6px 2px 0;white-space:nowrap;vertical-align:top;">Address :</td><td style="padding:2px 0;">${invoice.customer_address || '-'}</td></tr>
          </table>
        </td>
        <td style="vertical-align:top;width:45%;padding:0 28px 0 0;">
          <table class="vjc-stack-table" style="font-size:12px;color:#333;border-collapse:collapse;margin-left:auto;">
            <tr><td class="vjc-label" style="font-weight:700;padding:2px 6px 2px 0;white-space:nowrap;">Client ID :</td><td style="padding:2px 0;text-align:right;">${invoice.customer_id || '-'}</td></tr>
            <tr><td class="vjc-label" style="font-weight:700;padding:2px 6px 2px 0;white-space:nowrap;">Service Type :</td><td style="padding:2px 0;text-align:right;">${invoice.service_type || '-'}</td></tr>
            <tr><td class="vjc-label" style="font-weight:700;padding:2px 6px 2px 0;white-space:nowrap;">Invoice Number :</td><td style="padding:2px 0;text-align:right;">${invoice.invoice_number || '-'}</td></tr>
           <tr><td class="vjc-label" style="font-weight:700;padding:2px 6px 2px 0;white-space:nowrap;">Invoice Date :</td><td style="padding:2px 0;text-align:right;">${invoice.invoice_date ? new Date(invoice.invoice_date).toLocaleDateString("en-GB").replace(/\//g, "-") : "-"}</td></tr>
            <tr><td class="vjc-label" style="font-weight:700;padding:2px 6px 2px 0;white-space:nowrap;vertical-align:top;">Service Type :</td><td style="padding:2px 0;text-align:right;">${invoice.notes || invoice.service_type || '-'}</td></tr>
          </table>
        </td>
      </tr>
    </table>

    <div style="padding:22px 28px 0 28px;">
      <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
<tr>
  <td style="padding:4px 0;color:#333;font-weight:600;">Sub Total :</td>
  <td style="padding:4px 0;text-align:right;font-weight:700;color:#222;">
    INR ${subtotalNum.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
  </td>
</tr>

<tr>
  <td style="padding:4px 0;color:#333;font-weight:600;">Invoice Amount :</td>
  <td style="padding:4px 0;text-align:right;font-weight:700;color:#222;">
    INR ${invoiceAmountNum.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
  </td>
</tr>

${isIGST ? `
<tr>
  <td style="padding:4px 0;color:#333;font-weight:600;">IGST (${invoice.tax_percent || 18}%) :</td>
  <td style="padding:4px 0;text-align:right;font-weight:700;color:#222;">
    INR ${taxAmountTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
  </td>
</tr>
` : `
<tr>
  <td style="padding:4px 0;color:#333;font-weight:600;">CGST (${halfTaxPercent}%) :</td>
  <td style="padding:4px 0;text-align:right;font-weight:700;color:#222;">
    INR ${cgstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
  </td>
</tr>

<tr>
  <td style="padding:4px 0;color:#333;font-weight:600;">SGST (${halfTaxPercent}%) :</td>
  <td style="padding:4px 0;text-align:right;font-weight:700;color:#222;">
    INR ${sgstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
  </td>
</tr>
`}
        ${Number(invoice.paid_amount || 0) > 0 ? `
        <tr style="background:#f0fdf4;">
          <td style="padding:4px 0 4px 6px;color:#16a34a;font-weight:700;">Paid Amount:</td>
          <td style="padding:4px 6px 4px 0;text-align:right;font-weight:700;color:#16a34a;">
 INR ${Number(invoice.paid_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </td>
        </tr>
        <tr style="background:#fff3f0;">
          <td style="padding:4px 0 10px 6px;color:#d32f2f;font-weight:700;">Balance Amount:</td>
          <td style="padding:4px 6px 10px 0;text-align:right;font-weight:700;color:#d32f2f;">
INR ${Number(invoice.balance_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}          </td>
        </tr>` : ''}
      </table>
      <hr style="border:none;border-top:1px solid #e6e6e6;margin:0 0 8px 0;" />
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:2px 0;font-size:14px;font-weight:800;color:#111;">Grand Total :</td>
          <td style="padding:2px 0;text-align:right;font-size:14px;font-weight:800;color:#1565c0;">
 INR ${grandTotalNum.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </td>
        </tr>
      </table>
      <div style="text-align:right;font-size:11.5px;color:#555;margin-top:3px;">
        Grand Total in Word : <strong>${grandTotalWords}</strong>
      </div>
      ${Number(invoice.paid_amount || 0) > 0 ? `
      <div style="margin-top:6px;text-align:right;font-size:11.5px;color:#16a34a;font-weight:700;">
        Paid Amount in Word : <strong>${numberToWords(Number(invoice.paid_amount))} Only</strong>
      </div>` : ''}
    </div>

    ${invoice.notes ? `
    <div style="padding:16px 28px 0 28px;">
      <div style="font-size:13px;font-weight:700;color:#222;margin-bottom:5px;">Description</div>
      <div style="font-size:12px;color:#555;background:#f8f9fa;padding:10px 14px;border-radius:4px;line-height:1.6;">
        ${invoice.notes}
      </div>
    </div>` : ''}
    <div style="padding:20px 28px 24px 28px;">
      <div style="font-size:13px;font-weight:700;color:#222;margin-bottom:5px;">Notes / Terms &amp; Conditions</div>
      <div style="font-size:11px;color:#555;line-height:1.6;">
        <strong>Invoice Terms &amp; Conditions</strong><br/>
        <strong>Mode of Payment</strong><br/>
        Payments can be made via bank transfer, UPI, cheque, or any other method as communicated.
        All charges related to international transfers (if applicable) must be borne by the client.<br/>
        <strong>Service Delivery</strong><br/>
        Services will be rendered as per the agreed scope. VJC Overseas is not responsible for delays
        or failures due to incomplete documentation or non-cooperation by the client.<br/>
        <strong>Third-Party Charges</strong><br/>
        Any government, embassy, university, or third-party fees are not included in this invoice
        unless specifically mentioned. The client is solely responsible for paying these charges.<br/>
        <strong>Changes and Cancellations</strong><br/>
        Any changes in service scope requested after payment may result in additional charges.
        Cancellations must be made in writing and are subject to VJC Overseas' cancellation policy.<br/>
        <strong>Limitation of Liability</strong><br/>
        VJC Overseas will not be liable for any losses arising from visa rejection, university admission
        denial, or any outcome beyond our direct control.
      </div>
    </div>

    <div style="background:#111;color:#ddd;text-align:center;font-size:11px;padding:13px 18px;">
      VJC Immigration And Visa Consultants Pvt. Ltd., - 62/A, Sundari Reddy Bhavan, Ground Floor, Vengalrao Nagar,
      S.R.Nagar, Hyderabad-500038, Telangana, India.
    </div>
  </div>
</div>
</body>
    `;

    return html;
  },

  // ─── NEW: Quote → Customer mail ───────────────────────────────
  sendQuoteToCustomerMail: async (quote) => {
    const totalAmount = Number(quote.total_amount || 0);

    const html = `
<style>
  @media only screen and (max-width: 600px) {
    .vjc-stack-table, .vjc-stack-table tr, .vjc-stack-table td {
      display: block !important;
      width: 100% !important;
      box-sizing: border-box !important;
      text-align: left !important;
    }
  }
</style>
<div style="font-family:Arial,Helvetica,sans-serif;background:#eef1f4;padding:20px;">
  <div style="max-width:600px;margin:auto;background:#fff;border:1px solid #e2e2e2;border-radius:8px;overflow:hidden;">

    <table style="width:100%;border-collapse:collapse;background:#1976d2;">
  <tr>
    <td style="vertical-align:middle;width:60%;padding:20px 0 20px 28px;">
      <img src="https://vjc-invoice-backend.vercel.app/quote-logo.png"
        style="height:55px;display:block;" />
    </td>
    <td style="vertical-align:middle;width:40%;text-align:right;padding:20px 28px 20px 0;">
  <div style="font-size:24px;font-weight:800;color:#fff;letter-spacing:0.5px;">QUOTE</div>
  <div style="font-size:11.5px;color:#cfe3fb;margin-top:4px;">
    VJC Immigration And Visa Consultants Pvt. Ltd.,
  </div>
</td>
  </tr>
</table>

    <div style="padding:28px;">
      <div style="font-size:16px;color:#222;margin-bottom:4px;">
        Hi ${quote.customer_name || 'Customer'},
      </div>
      <div style="font-size:13.5px;color:#555;line-height:1.6;margin-bottom:20px;">
        Thank you for your interest in our services. Please find your quote details below.
      </div>

      <table class="vjc-stack-table" style="width:100%;border-collapse:collapse;font-size:13px;color:#333;margin-bottom:18px;">
        <tr>
          <td style="padding:8px 10px;font-weight:700;">Quote Number</td>
          <td style="padding:8px 10px;text-align:right;">${quote.quote_number || quote.quote_id || '-'}</td>
        </tr>
        <tr style="background:#f8f9fa;">
          <td style="padding:8px 10px;font-weight:700;">Quote Date</td>
          <td style="padding:8px 10px;text-align:right;">${quote.quote_date
  ? new Date(quote.quote_date).toLocaleDateString("en-GB").replace(/\//g, "-")
  : "-"
}</td>
        </tr>
       <tr>
  <td style="padding:8px 10px;font-weight:700;">Valid Until</td>
  <td style="padding:8px 10px;text-align:right;color:#d32f2f;font-weight:700;">
    ${quote.expiry_date
      ? new Date(quote.expiry_date).toLocaleDateString("en-GB").replace(/\//g, "-")
      : "-"
    }
  </td>
</tr>
        ${quote.salesperson ? `
        <tr style="background:#f8f9fa;">
          <td style="padding:8px 10px;font-weight:700;">Salesperson</td>
          <td style="padding:8px 10px;text-align:right;">${quote.salesperson}</td>
        </tr>` : ''}
      </table>

      ${(() => {
        const items = quote.line_items || [];
        if (!items.length) return '';

        let subTotal = 0, totalGST = 0;

        const rows = items.map((li) => {
          const qty      = Number(li.qty || 1);
          const rate     = Number(li.rate || 0);
          const discount = Number(li.discount || 0);
          const gstPct   = Number(li.gst || 0);

          const base    = qty * rate;
          const discAmt = base * (discount / 100);
          const taxable = base - discAmt;
          const gstAmt  = taxable * (gstPct / 100);
          const lineTotal = taxable + gstAmt;

          subTotal += taxable;
          totalGST += gstAmt;

          return `
            <tr>
              <td style="padding:8px 10px;border-bottom:1px solid #eee;">${li.description || '-'}</td>
              <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:center;">${qty}</td>
              <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right;">₹${rate.toLocaleString('en-IN')}</td>
              <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:center;">${gstPct}%</td>
              <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:600;">₹${lineTotal.toLocaleString('en-IN')}</td>
            </tr>`;
        }).join('');

        return `
        <div style="font-size:13px;font-weight:700;color:#222;margin-bottom:8px;">Service Details</div>
        <table style="width:100%;border-collapse:collapse;font-size:12.5px;color:#333;margin-bottom:16px;">
          <thead>
            <tr style="background:#f0f4f8;">
              <th style="padding:8px 10px;text-align:left;">Service</th>
              <th style="padding:8px 10px;text-align:center;">Qty</th>
              <th style="padding:8px 10px;text-align:right;">Rate</th>
              <th style="padding:8px 10px;text-align:center;">GST %</th>
              <th style="padding:8px 10px;text-align:right;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
        <table style="width:100%;border-collapse:collapse;font-size:12.5px;color:#333;margin-bottom:16px;">
          <tr>
            <td style="padding:3px 10px;">Sub Total</td>
            <td style="padding:3px 10px;text-align:right;">₹${subTotal.toLocaleString('en-IN')}</td>
          </tr>
          <tr>
            <td style="padding:3px 10px;">GST</td>
            <td style="padding:3px 10px;text-align:right;">₹${totalGST.toLocaleString('en-IN')}</td>
          </tr>
        </table>`;
      })()}

      <div style="background:#f0f7ff;border-radius:6px;padding:18px 20px;text-align:right;margin-bottom:20px;">
        <div style="font-size:12px;color:#555;">Total Quote Amount</div>
        <div style="font-size:24px;font-weight:800;color:#1565c0;">
          ₹${totalAmount.toLocaleString('en-IN')}
        </div>
      </div>

      ${quote.notes ? `
      <div style="font-size:12.5px;color:#555;line-height:1.6;border-top:1px solid #eee;padding-top:14px;">
        ${quote.notes}
      </div>` : ''}

      <div style="font-size:12.5px;color:#777;margin-top:22px;line-height:1.6;">
        Please reply to this email if you'd like to proceed or have any questions.
        We look forward to working with you.
      </div>
    </div>

    <div style="background:#111;color:#ddd;text-align:center;font-size:11px;padding:13px 18px;">
      VJC Immigration And Visa Consultants Pvt. Ltd., - Raheja Arcade, 16 &amp; 17, 5th Block,
      Koramangala, Bengaluru, Karnataka 560095
    </div>
  </div>
</div>
    `;

   await transporter.sendMail({
      from: `"VJC Overseas" <${process.env.EMAIL_USER}>`,
      to: quote.customer_email,
      subject: `Quote ${quote.quote_number || quote.quote_id} from VJC Overseas - ₹${totalAmount.toLocaleString('en-IN')}`,
      html,
    });
    console.log('✅ Quote mail sent to customer!');
  },

  // ─── NEW: Payment → Customer reminder mail ───────────────────────
  sendPaymentReminderMail: async (payment, stage, note) => {
    const amountDue      = Number(payment.amount_due || 0);
    const amountReceived = Number(payment.amount_received || 0);
    const balance         = amountDue - amountReceived;

    const stageColor = stage === 'Overdue' ? '#d32f2f' : '#ed6c02';
    const stageLabel  = stage === 'Overdue' ? '⚠️ Payment Overdue' : `🔔 ${stage}`;

    const html = `
<style>
  @media only screen and (max-width: 600px) {
    .vjc-stack-table, .vjc-stack-table tr, .vjc-stack-table td {
      display: block !important;
      width: 100% !important;
      box-sizing: border-box !important;
      text-align: left !important;
    }
  }
</style>
<div style="font-family:Arial,Helvetica,sans-serif;background:#eef1f4;padding:20px;">
  <div style="max-width:600px;margin:auto;background:#fff;border:1px solid #e2e2e2;border-radius:8px;overflow:hidden;">

    <div style="background:${stageColor};padding:24px 28px;">
      <div style="font-size:20px;font-weight:800;color:#fff;">VJC OVERSEAS</div>
      <div style="font-size:11px;color:#fde8e8;letter-spacing:1px;margin-top:2px;">
        IMMIGRATION &amp; VISA CONSULTANTS
      </div>
    </div>

    <div style="padding:28px;">
      <div style="display:inline-block;background:${stageColor};color:#fff;font-size:11px;
        font-weight:700;letter-spacing:0.5px;padding:4px 10px;border-radius:3px;margin-bottom:14px;">
        ${stageLabel}
      </div>

      <div style="font-size:16px;color:#222;margin-bottom:4px;">
        Hi ${payment.customer_name || 'Customer'},
      </div>
      <div style="font-size:13.5px;color:#555;line-height:1.6;margin-bottom:20px;">
        This is a reminder that payment for the invoice below is still pending.
        Please make the payment at the earliest to avoid any service delays.
      </div>

      <table class="vjc-stack-table" style="width:100%;border-collapse:collapse;font-size:13px;color:#333;margin-bottom:18px;">
        <tr>
          <td style="padding:8px 10px;font-weight:700;">Payment Reference</td>
          <td style="padding:8px 10px;text-align:right;">${payment.payment_no || '-'}</td>
        </tr>
        <tr style="background:#f8f9fa;">
          <td style="padding:8px 10px;font-weight:700;">Invoice #</td>
          <td style="padding:8px 10px;text-align:right;">${payment.invoice_id || 'MANUAL'}</td>
        </tr>
        <tr>
          <td style="padding:8px 10px;font-weight:700;">Due Date</td>
          <td style="padding:8px 10px;text-align:right;color:#d32f2f;font-weight:700;">
 ${payment.due_date
  ? new Date(payment.due_date).toLocaleDateString("en-GB").replace(/\//g, "-")
  : "-"
}
          </td>
        </tr>
      </table>

      <table style="width:100%;border-collapse:collapse;font-size:12.5px;color:#333;margin-bottom:16px;">
  <tr>
    <td style="padding:3px 10px;">Amount Due</td>
    <td style="padding:3px 10px;text-align:right;">
      ₹${amountDue.toLocaleString('en-IN')}
    </td>
  </tr>
</table>
      <div style="background:#fff3f0;border-radius:6px;padding:18px 20px;text-align:right;margin-bottom:20px;">
        <div style="font-size:12px;color:#555;">Balance Due</div>
        <div style="font-size:24px;font-weight:800;color:${stageColor};">
          ₹${balance.toLocaleString('en-IN')}
        </div>
      </div>

      ${note ? `
      <div style="font-size:12.5px;color:#555;line-height:1.6;border-top:1px solid #eee;padding-top:14px;">
        ${note}
      </div>` : ''}

      <div style="font-size:12.5px;color:#777;margin-top:22px;line-height:1.6;">
        If you've already made this payment, please disregard this email or share the
        payment reference with us so we can update our records.
      </div>
    </div>

    <div style="background:#111;color:#ddd;text-align:center;font-size:11px;padding:13px 18px;">
      VJC Immigration And Visa Consultants Pvt. Ltd., - Raheja Arcade, 16 &amp; 17, 5th Block,
      Koramangala, Bengaluru, Karnataka 560095
    </div>
  </div>
</div>
    `;

    await transporter.sendMail({
      from: `"VJC Overseas" <${process.env.EMAIL_USER}>`,
      to: payment.email,
      subject: `${stageLabel} — Payment Due ₹${balance.toLocaleString('en-IN')} (${payment.payment_no || ''})`,
      html,
    });
    console.log('✅ Payment reminder mail sent to customer!');
  },
};

module.exports = emailService;