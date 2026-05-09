export interface MailMessage {
	from: string;
	to: string[];
	subject: string;
	body: string;
}

export interface Mailer {
	send(msg: MailMessage): Promise<void>;
}
