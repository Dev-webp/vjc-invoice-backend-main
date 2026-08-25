// ─── Service Agreement PDF builder ──────────────────────────────────
// Mirrors the "Raghavender_Reddy_Service_Agreement" Word template.
// NOTE: DOB / Passport Number / Occupation are not present in the
// `customers` table today, so those 3 fields are omitted here.

const agreementService = {

  buildAgreementHtml: (data) => {
    const {
      customer_name,
      customer_email,
      customer_phone,
      customer_address,
      service_type,
      total_amount,
      paid_amount,
      balance_amount,
      paid_date,
      agreement_number,
    } = data;

    const fmt = (n) => Number(n || 0).toLocaleString('en-IN');

    const agreementDate = new Date().toLocaleDateString('en-GB', {
      day: '2-digit', month: 'long', year: 'numeric',
    });

    const paidDateFormatted = paid_date
      ? new Date(paid_date).toLocaleDateString('en-GB').replace(/\//g, '.')
      : '-';

    const html = `
<div style="font-family:Georgia,'Times New Roman',serif;padding:30px;color:#1a1a1a;font-size:13px;line-height:1.6;">

  <h2 style="text-align:center;text-decoration:underline;">SERVICE AGREEMENT</h2>

  <p>This Deed of SERVICE AGREEMENT is made and executed on this day <strong>${agreementDate}</strong> at Hyderabad between:</p>

  <p><strong>M/s VJC Immigration and Visa Consultants Pvt. Ltd. (VJC Overseas), Office located at #62/A, Ground Floor, Sundari Reddy Bhavan, Vengal Rao Nagar, S.R Nagar, Hyderabad - 500038, Telangana, India.</strong></p>

  <p style="text-align:center;"><strong>And</strong></p>

  <p>
    <strong>Name:</strong> ${customer_name || '-'}<br/>
    <strong>Mail ID:</strong> ${customer_email || '-'}<br/>
    <strong>Phone Number:</strong> ${customer_phone || '-'}<br/>
    <strong>Address:</strong> ${customer_address || '-'}<br/>
    <strong>Services Opted:</strong> ${service_type || '-'}
  </p>

  <div style="background:#f8f9fa;border:1px solid #ddd;border-radius:6px;padding:14px 18px;margin:18px 0;">
    <p style="margin:4px 0;"><strong>Agreement No:</strong> ${agreement_number || '-'}</p>
    <p style="margin:4px 0;"><strong>Total Amount:</strong> ₹${fmt(total_amount)}/-</p>
    <p style="margin:4px 0;color:#2e7d32;"><strong>Paid Amount:</strong> ₹${fmt(paid_amount)}/-</p>
    <p style="margin:4px 0;color:#d32f2f;"><strong>Balance Amount:</strong> ₹${fmt(balance_amount)}/-</p>
    <p style="margin:4px 0;"><strong>Paid Date:</strong> ${paidDateFormatted}</p>
  </div>

  <p>Here in after VJC Overseas is referred to "First Party" and client is referred to "Second Party".</p>

  <p>Whereas First Party is into Migration and Education consultancy services to countries such as Canada, Australia, USA & Germany etc. offering integrated package of services to students/clients who wish to study/settle abroad for Education/immigration.</p>

  <p>Whereas Second Party is the student/immigrant who intends to apply for <strong>${service_type || 'the opted service'}</strong> and approached the First Party for processing; AND Whereas First Party agreed for the same on the following:</p>

  <h3>Terms and conditions of services:</h3>
  <ol type="a">
    <li>VJC Overseas will assist and guide you towards getting the visa for the respective country. However, the final decision is that of a visa granting authority based on the information / document of evidence furnished in your visa application.</li>
    <li>A Documents Checklist will be provided keeping in view the requirements of the respective country's visa authority.</li>
    <li>A Case Officer would be appointed to process the documentation part, which would assist you with preparing a file on a timely basis.</li>
    <li>Immigration laws, policies & fees are subject to frequent change without prior notice and no responsibility is accepted for any errors in the guidance and information provided.</li>
    <li>VJC Overseas does not and cannot make any guarantees in context of approval or validity of any visa application made by you or by VJC Overseas on your behalf.</li>
    <li>VJC Overseas will assist you in a limited manner for filing applications based on the information or documents provided by you and will not provide taxation, business, accounting, investment or other professional advice or services.</li>
    <li>In case we cannot process your application for the agreed country, we will give you service for the other possible country / process within our limits.</li>
  </ol>

  <h3>Refund Policy:</h3>
  <p>VJC Overseas will make all efforts by following the process and submitting the visa application but in an unlikely situation of the visa rejection, the below refund is applicable:</p>
  <ul>
    <li>100% Refund is applicable only to those applicants who had made a one-time payment for the full service and for the visa rejection caused due to documentation submitted to the consulate/Embassy is considered as inappropriate filing.</li>
    <li>100% non-refundable if the client withdraws for personal reasons, fails to furnish required documents, submits fraudulent documents, or fails to meet the required score/criteria for the process.</li>
  </ul>
  <p>All refund cases would be cleared between <strong>45-60 Working days</strong>.</p>

  <h3>Validity and Transfer of Services:</h3>
  <p>The agreement will be valid for 2 years from the date of execution of this agreement. If you wish to change/shift/transfer the process from one country to another, then you will have to pay 50% of the amount.</p>

  <p>This agreement is made on <strong>${agreementDate}</strong> and the parties to this deed have put their signatures at their free will and consent and after going through all the terms and conditions.</p>

  <table style="width:100%;margin-top:40px;">
    <tr>
      <td style="width:50%;"><strong>First Party</strong><br/>VJC Overseas</td>
      <td style="width:50%;"><strong>Second Party</strong><br/>${customer_name || '-'}</td>
    </tr>
  </table>

</div>
    `;

    return html;
  },
};

module.exports = agreementService;