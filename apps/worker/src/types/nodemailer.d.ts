declare module "nodemailer" {
	namespace nodemailer {
		interface Transporter {
			sendMail(message: unknown): Promise<unknown>;
		}

		interface TransportOptions {
			host: string;
			port: number;
			secure: boolean;
			auth: {
				user: string;
				pass: string;
			};
		}

		function createTransport(options: TransportOptions): Transporter;
	}

	export = nodemailer;
}
