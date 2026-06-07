// Mirrors the validated, normalized submission payload (see form/schema.ts).
export interface Assessment {
	assessmentType: string;
	completedBy: string;
	dateOfAssessment: string; // ISO yyyy-mm-dd
	attachmentName: string; // original filename of the row's upload
}

export interface SubmissionPayload {
	childYouthsFirstName: string;
	childYouthsMiddleNameS?: string;
	childYouthsLegalLastName: string;
	childYouthsDateOfBirth: string; // ISO yyyy-mm-dd
	childYouthsGender: string;
	agreementSignatorysLegalFirstName: string;
	agreementSignatorysLegalLastName: string;
	childYouthsDateOfBirth1: string; // signatory DOB
	AgreementSigGender: string;
	AgreementSigRelationship: string;
	primaryPhoneNumber: string;
	email: string;
	screening: 'Yes' | 'No';
	simplecheckboxes?: string[]; // not-submitting reasons (screening=No)
	editGrid?: Assessment[]; // assessments (screening=Yes)
	PrimaryCareAndControl: boolean;
	iAmTheAgreementSignatory?: boolean; // consent to collection (screening=Yes)
	iAmTheAgreementSignatory1?: boolean; // consent to disclosure (screening=Yes)
	iAmTheAgreementSignatory2?: boolean; // confirm not submitting (screening=No)
	signature: string; // data-URL PNG
	dateSigned: string; // ISO yyyy-mm-dd
	browserFingerprint?: string;
	csrfTokenEcho?: string;
}
