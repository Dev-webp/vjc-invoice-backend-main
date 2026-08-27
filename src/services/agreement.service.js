// ─── Service Agreement PDF builder ──────────────────────────────────
// Mirrors the FULL "Raghavender_Reddy_Service_Agreement" Word template,
// section for section — Terms, Scope of Services, Communications,
// Assessment, Guarantee of Visa, Fees Payable, full Refund Policy,
// Complaints, Notice, Force Majeure, Jurisdiction, Validity & Transfer.
//
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
<div style="font-family:Georgia,'Times New Roman',serif;padding:30px;color:#1a1a1a;font-size:13px;line-height:1.65;">

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
    <p style="margin:4px 0;"><strong>Total Amount:</strong> &#8377;${fmt(total_amount)}/-</p>
    <p style="margin:4px 0;color:#2e7d32;"><strong>Paid Amount:</strong> &#8377;${fmt(paid_amount)}/-</p>
    <p style="margin:4px 0;color:#d32f2f;"><strong>Balance Amount:</strong> &#8377;${fmt(balance_amount)}/-</p>
    <p style="margin:4px 0;"><strong>Paid Date:</strong> ${paidDateFormatted}</p>
  </div>

  <p>Here in after VJC Overseas is referred to "First Party" and client is referred to "Second Party".</p>

  <p>Whereas First Party is into Migration and Education consultancy services to countries such as Canada, Australia, USA & Germany etc. offering integrated package of services to students/clients who wish to study/settle abroad for Education/immigration.</p>

  <p>Whereas Second Party is the student/immigrant who intends to apply for <strong>${service_type || 'the opted service'}</strong> and approached the First Party for processing; AND Whereas First Party agreed for the same on the following:</p>

  <h3>Terms and conditions of services:</h3>
  <ol type="a">
    <li>VJC Overseas will assist and guide you towards getting the visa for the respective country. However, the final decision is that of a visa granting authority based on the information / document of evidence furnished in your visa application.</li>
    <li>A Documents Checklist will be provided keeping in view the requirements of the respective country's visa authority.</li>
    <li>A Case Officer would be appointed to process the documentation part, which would assist you with preparing a file on a timely basis. VJC Overseas team or the assigned case officer would not prepare any document from our end but would guide / suggest the requirements and help you prepare them in the right way.</li>
    <li>Whilst VJC Overseas and its Consultants endeavor to offer the best possible advice, immigration laws, policies & fees are subject to frequent change without prior notice and no responsibility is accepted for any errors in the guidance and information provided, typographic or otherwise.</li>
    <li>VJC Overseas does not and cannot make any guarantees in context of approval or validity of any visa application made by you or by VJC Overseas on your behalf. The power to grant or refuse visa applications vests solely with the Immigration authority of respective countries only.</li>
    <li>VJC Overseas will assist you in a limited manner for filing applications based on the information or documents provided by you and will not provide taxation, business, accounting, investment or other professional advice or services. VJC Overseas advises clients to seek separate independent professional advice regarding these matters.</li>
    <li>In case we cannot process your application for the agreed country, we will give you service for the other possible country / process within our limits.</li>
  </ol>

  <h3>Scope of Services:</h3>
  <ol>
    <li>Visa slot Booking &ndash; (Processing time totally depends upon the Visa appointment slots availability)</li>
    <li>Resume Writing &ndash; EU standard and Cover letter</li>
    <li>Resume marketing assistance for Job search &ndash; Complimentary service. (VJC Overseas is not responsible for 100% Job assurance or positive responses or for Interview Scheduling, VJC will target the potential employers suiting your profile and maximize the scope to areas where there are openings in Germany)</li>
    <li>Visa form filling</li>
  </ol>

  <h3>Communications:</h3>
  <ol type="A">
    <li>When you visit VJC Overseas, send an e-mail(s) to us or communicate with us through any other mode(s) of communication, you agree that all such communications (including agreements, notices, disclosure, etc.) satisfy all legal requirements to be in writing.</li>
    <li>We will communicate with you by e-mail or any other mode of communication. If you do not respond to any communication related to the provision of the Service within four (4) working weeks, VJC has the right to terminate the services.</li>
    <li>While VJC shall try its best to expedite the file to the respective Embassy/VFS etc. as soon as possible, it's also important to note that we take between 15-30 days to review all documents, after the client submits the entire documents before submitting the file either manually or online. Client agrees that he/she would not insist/put pressure to submit the file which only would hamper visa acceptance chances.</li>
    <li>Once a client enrolls in the process, he/she is expected to submit all the documents in 30 days' time post signing the agreement. Failure to do so would invite additional charges/termination of services, which VJC management would think to be appropriate.</li>
    <li>VJC does not deal in any fraudulent documents including Education, fund maintenance, work experience etc. The client agrees that VJC or any of its employees is not involved (directly or indirectly) in any manner it is possible for the same.</li>
  </ol>

  <h3>Assessment:</h3>
  <p>The Assessment is specifically designed to provide you with a preliminary assessment of your ability to satisfy the Visa criteria for your selected visa/permit type. The client understands that the report was made based on the information provided by the client. This needs to be supported by valid documentation. As such, you should not rely on this result alone as a true indication of your ability to apply for migration.</p>

  <h3>Guarantee of Visa:</h3>
  <p>VJC is not part of any Immigration Authority / High Commission. We are a private company and do not have the authority to grant you a visa of any kind. We can only assist and advise people who want to migrate or travel to their desired country. Please note that the final decision on all visa applications rests with the relevant Immigration authority in respective countries.</p>

  <h3>Fees Payable:</h3>
  <p>Our fee DOES NOT include other costs which are part of the migration process such as Immigration application lodging fees, medical and police checks, translation of documents, notarization/attestation & courier etc. As part of the Service(s) which is/are provided to you, an approximate indication of the fees, which form part of the process, will be set out for you, together with clarification as to when these costs are due.</p>

  <h3>Refund Policy:</h3>
  <p>VJC Overseas will make all efforts by following the process and submitting the visa application but in an unlikely situation of the visa rejection, the below refund is applicable:</p>
  <ul>
    <li>100% Refund is applicable only to those applicants who had made a one-time payment for the full service and for the visa rejection caused due to documentation submitted to the consulate/Embassy is considered as inappropriate filing (Visa rejection proof is to be shared by client to verify the reason for rejection).</li>
    <li>Please Note: The client will be fully responsible if he fails to submit the documents as per the required formats given by VJC process teams and if there is any discrepancy in the amount mentioned in the Demand draft payable to the German consulate.</li>
    <li>100% non-refundable for the following reasons:
      <ul>
        <li>If you sign up for the service but later change your mind for any personal reason and decide to withdraw.</li>
        <li>If you do not wish to continue with our services for any personal reasons.</li>
        <li>If you fail to furnish the required documents within the interview period.</li>
        <li>Failure to provide sufficient funds, if required for settlement or maintenance by the client, necessary for the process.</li>
        <li>Failure to Provide all required documents within 60 working Days, then First Party has right to place the Case on Temporary Hold for 60 days and after Temporary Hold even if the Second Party does not submit the required documents to file the application, the First Party has right to close the Case Permanently.</li>
        <li>Submission of fraudulent documents.</li>
        <li>Prior violation of any immigration or visa law by the client or any of his or her family members included in the application (if applicable).</li>
        <li>Late submission of any additional documents requested by the concerned authority during the process at any stage.</li>
        <li>If the concerned visa authority implements any changes that affect your application.</li>
        <li>If the points have been reduced due to changes in the applicant's profile.</li>
        <li>If the applicant is unable to achieve the required score in the English language test.</li>
        <li>If the partial service/consultation fee was paid.</li>
      </ul>
    </li>
  </ul>
  <p>All the refund cases would be cleared between <strong>45-60 Working days</strong>.</p>

  <h3>Complaints:</h3>
  <ol type="a">
    <li>In case the user has any complaints regarding our services or processes, he/she can approach us and register the complaint. VJC Overseas complaints are handled by a dedicated team responsible for resolving clients' queries and issues regarding VJC Overseas. This team ensures that complaints are addressed in the best possible manner and provides solutions that result in optimal service for clients.</li>
    <li>Only genuine complaints are entertained by our team. Complaints that are not genuine, and are a result of the client's own negligence, misunderstanding, or fault, will not be addressed by VJC Overseas. Such non-genuine complaints may include visa rejections due to non-submission of documents by the client, absence of the client on the interview date at the immigration office resulting in visa rejection, etc. In such cases, VJC Overseas will not be responsible, and complaints relating to these issues will not be entertained.</li>
    <li>VJC Overseas has a dedicated divergence team that handles refund cases. The client agrees that under no circumstance will they seek assistance from any media and is bound by this agreement to refrain from posting any defamatory or derogatory content on websites (such as Consumer Court, Mouth Shut, etc.), internet blogs, social media, or any other platform that may bring disrepute to the brand image of VJC Overseas. Any violation will be dealt with strictly in an appropriate court of law.</li>
    <li>Both parties to this agreement mutually agreed to refer all disputes arising out of this contract to the arbitrator. The provisions of the Arbitration and Conciliation Act 1996 as amended by the government from time to time will apply for adjudication of the disputes that may arise or referred to arbitrator by either of the parties to the agreement. The jurisdiction of the civil court and all other courts is expressly barred for adjudicating the disputes arising out of this contract except referring to the dispute with the arbitrator. The fee of an arbitrator shall be paid by the parties to the contract equally irrespective of whoever may approach for arbitration.</li>
  </ol>

  <h3>Notice:</h3>
  <p>Any notice, claim correspondence or other documents relating to this Agreement shall be in writing in the English language and shall be deemed to be duly given or made when delivered by registered post to the Party to which it is to be given or made at the following address:</p>
  <p>VJC Immigration and Visa Consultants Pvt. Ltd. (VJC Overseas), Office located at #62/A, Ground Floor, Sundari Reddy Bhavan, Vengal Rao Nagar, S.R Nagar, Hyderabad - 500038, Telangana, India.</p>

  <h3>Force Majeure:</h3>
  <p>If performance of this Agreement is prevented, restricted or interfered with by reason of acts of God, wars, revolution, civil commotion, acts of public enemy, embargo, epidemic, quarantine, acts of government (including state or local government) acting in their sovereign capacity, labor difficulties (including strikes, slowdowns, picketing or boycotts), or any other circumstances beyond the reasonable control of a Party and not involving any fault, misconduct or negligence of the Party affected ("Event of Force Majeure"), the Party affected, upon giving prompt notice to the other Party, shall be excused from such performance on a day-to-day basis during the continuance of such Event of Force Majeure provided, however, that the Party so affected shall use its best reasonable efforts to avoid or remove such causes of non-performance and both Parties shall proceed immediately with the performance of their obligations under this Agreement whenever such causes are removed or avoided, or such causes otherwise cease. It is agreed between the Parties that the affected party shall not be liable to pay the charges or any other charges payable pursuant to this Agreement for the period when the services cannot be performed.</p>

  <h3>Jurisdiction:</h3>
  <p>All disputes will be in the jurisdiction of Hyderabad.</p>

  <h3>Validity and Transfer of Services:</h3>
  <ul>
    <li>The agreement will be valid for 2 years from the date of execution of this agreement.</li>
    <li>If you wish to change/shift/transfer the process from one country to another, or change the service to another country, then you will have to pay 50% of the amount.</li>
  </ul>

  <p>This agreement is made on <strong>${agreementDate}</strong> first mentioned above and the parties to this deed have put their signatures at their free will and consent and after going through all the terms and conditions before the following:</p>

  <h3>WITNESSES:</h3>
  <table style="width:100%;margin-top:20px;">
    <tr>
      <td style="width:50%;"><strong>First Party</strong><br/>VJC Overseas<br/><br/>1.<br/>2.</td>
      <td style="width:50%;"><strong>Second Party</strong><br/>${customer_name || '-'}<br/><br/>1.<br/>2.</td>
    </tr>
  </table>

</div>
    `;

    return html;
  },
};

module.exports = agreementService;