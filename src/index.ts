import * as crypto from 'crypto'
import * as superagent from 'superagent'

import {
	ApplePayInitPayload,
	Currency,
	GooglePayInitPayload,
	InitPayload,
	InputPayload,
	Language,
	OneClickInitPayload,
	PaymentMethod,
	PaymentOperation,
	PaymentResult,
	PaymentStatus,
	PaymentStatusResult,
	ResultCode,
	ReturnMethod,
} from './types/Payment'

import { Config } from './types/Config'
import GatewayError from './types/GatewayError'
import { Logger } from './types/Logger'
import VerificationError from './types/VerificationError'
import { getObjectTextToSign } from './utils/getObjectTextToSign'

export {
	Currency, GatewayError, Language, PaymentMethod, PaymentOperation, PaymentResult,
	PaymentStatus,
	ResultCode,
	ReturnMethod, VerificationError
}
export class CSOBPaymentModule {
	private readonly logger?: Logger
	private readonly config: Config

	constructor({ logger = true, ...config }: Config) {
		if (typeof logger === 'function') {
			this.logger = logger
		} else if (logger === true) {
			this.logger = console
		} else if (logger === false) {
			this.logger = undefined
		}

		this.config = config

		this.config.payloadTemplate = {
			merchantId: this.config.merchantId,
			payMethod: 'card',
			returnUrl: this.config.calbackUrl,
			returnMethod: ReturnMethod.POST,
		}
	}

	async commonInit(payload, initUrlPath: string): Promise<PaymentResult> {
		console.log('-------------  INIT_PAYLOAD -------------')
		console.log(payload)
		console.log('------------- /INIT_PAYLOAD -------------')

		try {
			const result = await superagent.post(`${this.config.gateUrl}${initUrlPath}`).send(payload)
			if (this.verify(this.createResultMessage(result.body), result.body.signature)) {
				if (result.body.resultCode.toString() === '0') {
					return result.body
				}

				this.logger?.error({ result }, 'Payment failed')
				throw new GatewayError('Payment failed', result.body)
			} else {
				this.logger?.error({ result }, 'Verification failed')
				throw new VerificationError('Verification failed')
			}
		} catch (err) {
			this.logger?.error({ err }, 'Uknown error')
			throw err
		}
	}

	async init(input: InitPayload): Promise<PaymentResult> {
		const payload = input
		payload['merchantId'] = this.config.merchantId
		payload['dttm'] = this.createDttm()
		payload['signature'] = this.sign(this.createPayloadMessage(payload))
		return this.commonInit(payload, '/payment/init')
	}

	async googlePayInit(input: GooglePayInitPayload): Promise<PaymentResult> {
		const payload = input
		payload['merchantId'] = this.config.merchantId
		payload['dttm'] = this.createDttm()
		payload['payload'] = input.payload
		payload['signature'] = this.sign(this.createPayloadMessage(payload))
		return this.commonInit(input, '/googlepay/init')
	}

	async applePayInit(input: ApplePayInitPayload): Promise<PaymentResult> {
		const payload = input
		payload['merchantId'] = this.config.merchantId
		payload['dttm'] = this.createDttm()
		payload['payload'] = input.payload
		payload['signature'] = this.sign(this.createPayloadMessage(payload))
		return this.commonInit(input, '/applepay/init')
	}

	async oneClickInit(input: OneClickInitPayload): Promise<PaymentResult> {
		const payload = input
		payload['merchantId'] = this.config.merchantId
		payload['dttm'] = this.createDttm()
		payload['signature'] = this.sign(this.createPayloadMessage(payload))
		return this.commonInit(input, '/oneclick/init')
	}

	public createPaymentPayload(payload: InputPayload, oneClick: boolean): any {
		return {
			...this.config.payloadTemplate,
			dttm: this.createDttm(),
			payOperation: oneClick ? PaymentOperation.ONE_CLICK_PAYMENT : PaymentOperation.PAYMENT,
			payMethod: PaymentMethod.CARD,
			returnMethod: 'GET',
			closePayment: true,
			...payload,
		}
	}

	getRedirectUrl(id: string) {
		const dttm = this.createDttm()

		const signature = this.sign(`${this.config.merchantId}|${id}|${dttm}`)
		const url = `${this.config.gateUrl}/payment/process/${this.config.merchantId}/${id}/${dttm}/${encodeURIComponent(
			signature,
		)}`

		return url
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	async processAppPayment(type: 'googlepay' | 'applepay', payId: string, fingerprint?: { [key: string]: unknown }) {
		const dttm = this.createDttm()
		const objectToSign = {
			merchantId: this.config.merchantId,
			payId,
			dttm,
			fingerprint,
		}
		const payload = {
			...objectToSign,
			signature: this.sign(getObjectTextToSign(objectToSign)),
		}

		const url = `${this.config.gateUrl}/${type}/process`

		try {
			const result = await superagent.post(url).send(payload)

			if (this.verify(this.createResultMessage(result.body), result.body.signature)) {
				if (result.body.resultCode.toString() === '0') {
					return result.body
				}

				this.logger?.error({ result }, 'Process payment operation failed')
				throw new GatewayError('Process payment operation failed', result.body)
			} else {
				this.logger?.error({ result }, 'Verification failed')
				throw new VerificationError('Verification failed')
			}
		} catch (err) {
			this.logger?.error({ err }, 'Uknown error')
			throw err
		}
	}

	async processOneClickPayment(payId: string) {
		const objectToSign = {
			merchantId: this.config.merchantId,
			payId,
			dttm: this.createDttm(),
		}
		const payload = {
			...objectToSign,
			signature: this.sign(getObjectTextToSign(objectToSign)),
		}

		try {
			const result = await superagent.post(`${this.config.gateUrl}/oneclick/process/`).send(payload)

			if (this.verify(this.createResultMessage(result.body), result.body.signature)) {
				if (result.body.resultCode.toString() === '0') {
					return result.body
				}

				this.logger?.error({ result }, 'Process failed')
				throw new GatewayError('Process failed', result.body)
			} else {
				this.logger?.error({ result }, 'Verification failed')
				throw new VerificationError('Verification failed')
			}
		} catch (err) {
			this.logger?.error({ err }, 'Uknown error')
			throw err
		}
	}

	async status(id: string): Promise<PaymentStatusResult> {
		const dttm = this.createDttm()
		const signature = this.sign(`${this.config.merchantId}|${id}|${dttm}`)

		const url = `${this.config.gateUrl}/payment/status/${this.config.merchantId}/${id}/${dttm}/${encodeURIComponent(
			signature,
		)}`
		const result = await superagent.get(url).send()

		const message = this.createResultMessage(result.body)
		if (this.verify(message, result.body.signature)) {
			if (result.body.resultCode.toString() === '0') {
				return result.body
			}

			this.logger?.error({ result }, 'Status failed')
			throw new GatewayError('Status failed', result.body)
		}

		throw new VerificationError('Verification failed')
	}

	public async reverse(id: string): Promise<PaymentResult> {
		const payload = {
			merchantId: this.config.merchantId,
			payId: id,
			dttm: this.createDttm(),
		}

		payload['signature'] = this.sign(this.createPayloadMessage(payload))
		const result = await superagent.put(`${this.config.gateUrl}/payment/reverse`).send(payload)

		if (this.verify(this.createResultMessage(result.body), result.body.signature)) {
			if (result.body.resultCode.toString() === '0') {
				return result.body
			}

			throw new GatewayError('reverse failed', result.body)
		}

		throw new VerificationError('Verification failed')
	}

	public async close(id: string, totalAmount?: number): Promise<PaymentResult> {
		const payload = {
			merchantId: this.config.merchantId,
			payId: id,
			dttm: this.createDttm(),
			...(typeof totalAmount === 'number' ? { totalAmount } : {}),
		}

		payload['signature'] = this.sign(this.createMessageString(payload, null))
		const result = await superagent.put(`${this.config.gateUrl}/payment/close`).send(payload)

		if (this.verify(this.createResultMessage(result.body), result.body.signature)) {
			if (result.body.resultCode.toString() === '0') {
				return result
			}

			throw new GatewayError('Close failed', result.body)
		}

		throw new VerificationError('Verification failed')
	}

	public async refund(id: string, amount: number) {
		const payload = {
			merchantId: this.config.merchantId,
			payId: id,
			dttm: this.createDttm(),
			amount,
		}

		payload['signature'] = this.sign(this.createMessageString(payload))
		const result = superagent.put(`${this.config.gateUrl}/payment/refund`).send(payload)

		if (this.verify(this.createResultMessage(result.body), result.body.signature)) {
			if (result.body.resultCode.toString() === '0') {
				return result
			}

			throw new GatewayError('Refund failed', result.body)
		}

		throw new VerificationError('Verification failed')
	}

	public async echo(method = 'POST', type?: 'googlepay' | 'applepay' | 'oneclick', origPayId?: string) {
		const urlPaths = {
			default: '/echo',
			googlepay: '/googlepay/echo',
			applepay: '/applepay/echo',
			oneclick: '/oneclick/echo',
		}
		const urlPath = urlPaths[type] || urlPaths.default

		const payload = {
			merchantId: this.config.merchantId,
			dttm: this.createDttm(),
			origPayId,
			signature: null,
		}
		payload['signature'] = this.sign(this.createPayloadMessage(payload))

		let result
		try {
			if (method === 'POST') {
				result = await superagent
					.post(`${this.config.gateUrl}${urlPath}`)
					.set('Content-Type', 'application/json')
					.send(payload)
			} else {
				result = await superagent
					.get(
						`${this.config.gateUrl}${urlPath}/${payload.merchantId}/${payload.dttm}/${encodeURIComponent(
							payload.signature,
						)}`,
					)
					.send()
			}

			// if (this.verify(this.createResultMessage(result.body), result.body.signature)) {
			if (result.body.resultCode.toString() === '0') {
				return result.body
			}

			throw new GatewayError('Echo failed', result.body)
			// }
		} catch (err) {
			console.log(err)
		}

		throw new VerificationError('Verification failed')
	}

	public createPayloadMessage(payload) {
		const payloadKeys = [
			'merchantId',
			'origPayId',
			'orderNo',
			'payId',
			'dttm',
			'clientIp',
			'payOperation',
			'payMethod',
			'totalAmount',
			'currency',
			'closePayment',
			'payload',
			'returnUrl',
			'returnMethod',
			'clientInitiated',
			'sdkUsed',
		]
		const cartItemKeys = ['name', 'quantity', 'amount', 'description']
		let payloadMessageArray = this.createMessageArray(payload, payloadKeys)
		if (payload.cart) {
			payload.cart.forEach((cartItem) => {
				payloadMessageArray = payloadMessageArray.concat(this.createMessageArray(cartItem, cartItemKeys))
			})
		}

		payloadMessageArray = payloadMessageArray.concat(
			this.createMessageArray(payload, [
				'description',
				'merchantData',
				'customerId',
				'language',
				'ttlSec',
				'logoVersion',
				'colorSchemeVersion',
			]),
		)
		return payloadMessageArray.join('|')
	}

	public sign(text: string) {
		return crypto.createSign('sha256').update(text).sign(this.config.privateKey, 'base64')
	}

	private createDttm() {
		const now = new Date()
		now.setUTCHours(now.getUTCHours() + 1)

		return (
			now.getUTCFullYear() +
			(now.getUTCMonth() + 1).toString().padStart(2, '0') +
			now.getUTCDate().toString().padStart(2, '0') +
			now.getUTCHours().toString().padStart(2, '0') +
			now.getUTCMinutes().toString().padStart(2, '0') +
			now.getUTCSeconds().toString().padStart(2, '0')
		)
	}

	private verify(text: string, signature: string) {
		return crypto.createVerify('sha256').update(text).verify(this.config.bankPublicKey, signature, 'base64')
	}

	private createMessageArray(data, keys) {
		if (!keys) {
			keys = Object.keys(data)
		}
		const filtered = keys.map((key) => data[key]).filter((item) => typeof item !== 'undefined')
		return filtered
	}

	private createMessageString(data, keys = []) {
		return this.createMessageArray(data, keys).join('|')
	}

	private createResultMessage(result) {
		const resultKeys = [
			'merchantId',
			'payId',
			'dttm',
			'resultCode',
			'resultMessage',
			'paymentStatus',
			'statusDetail',
			'authCode',
			'merchantData',
		]

		let messageString = this.createMessageString(result, resultKeys)

		if (result.actions) {
			messageString = messageString.concat('|' + getObjectTextToSign(result.actions))
		}

		return messageString
	}
}
